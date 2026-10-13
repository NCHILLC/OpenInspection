// @vitest-environment happy-dom
/**
 * A refused WebSocket handshake and a dead network look the same to a browser,
 * so "expired" has to come from somewhere other than the socket. These pin where:
 * a socket that closed without opening, plus a 401 from the API on the same
 * cookie. Each "is not expired" case is the control for the first test: a hook
 * that said "expired" on every failed handshake would pass it alone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePresence } from "./usePresence";

/** A socket the test settles by hand: `open()` accepts the handshake, `close()` before it refuses. */
class StubSocket extends EventTarget {
  static readonly OPEN = 1;
  static last: StubSocket;
  readyState = 0;
  constructor() {
    super();
    StubSocket.last = this;
  }
  send(): void { /* presence frames are not under test */ }
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

const fetchMock = vi.fn();
const mount = () => renderHook(() => usePresence({ inspectionId: "i1", userId: "u1", userName: "Inspector" }));
/** Refuse the newest socket's handshake, then let the session check answer. */
const refuse = () => act(async () => {
  StubSocket.last.close();
  await vi.advanceTimersByTimeAsync(0);
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", StubSocket);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("usePresence session expiry", () => {
  it("reads expired when the handshake is refused and the API answers 401, until a retry opens", async () => {
    fetchMock.mockResolvedValue({ status: 401 });
    const { result } = mount();
    const first = StubSocket.last;

    await refuse();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/me");
    expect(result.current.status).toBe("expired");

    // The retry is refused too. The reading holds from the moment it closes,
    // before its own check has answered: no flash of "Reconnecting…".
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(StubSocket.last).not.toBe(first);
    act(() => StubSocket.last.close());
    expect(result.current.status).toBe("expired");

    // Signed in from another tab: the next retry is let in.
    await act(() => vi.advanceTimersByTimeAsync(800));
    act(() => StubSocket.last.open());
    expect(result.current.status).toBe("connected");
  });

  it("is not expired when the handshake is refused but the session is live", async () => {
    fetchMock.mockResolvedValue({ status: 200 });
    const { result } = mount();
    await refuse();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("connecting");
  });

  it("is not expired when the API cannot be reached, and does not ask while offline", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = mount();
    await refuse();
    expect(result.current.status).toBe("connecting");

    fetchMock.mockClear();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(() => vi.advanceTimersByTimeAsync(400));
    await refuse();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe("connecting");
  });

  it("does not ask when an open socket drops: that one was let in", async () => {
    const { result } = mount();
    act(() => StubSocket.last.open());
    await refuse();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe("reconnecting");
  });
});
