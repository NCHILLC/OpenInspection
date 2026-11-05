/** Local-only ISN simulator used by playwright.isn.config.ts. No real credentials or writes to ISN. */
import { createServer } from 'node:http';

const order = {
    id: 'fixture-isn-order', oid: 991, ordertype: 'fixture-home',
    address1: '991 ISN Fixture Street', city: 'Testville', stateabbreviation: 'NC', zip: '28054',
    datetime: '2026-11-06 10:00:00', canceled: 'no', services: [],
};
let nextOrder = 991;
createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/health') return response.end('{"ok":true}');
    if (path === '/__test/reset' && request.method === 'POST') {
        order.oid = ++nextOrder;
        order.id = `fixture-isn-${nextOrder}`;
        order.address1 = `${nextOrder} ISN Fixture Street`;
        return response.end(JSON.stringify({ order }));
    }
    if (request.method !== 'GET') { response.writeHead(405); return response.end('{"status":"error","message":"Read-only fixture"}'); }
    const payload = path.endsWith('/ordertypes') ? { ordertypes: [{ id: 'fixture-home', name: 'Home inspection' }] }
        : path.endsWith('/orders') ? { orders: [order] }
        : path.endsWith(`/order/${order.id}`) ? { order }
        : null;
    response.end(JSON.stringify(payload ? { status: 'ok', ...payload } : { status: 'error', message: 'Unknown fixture endpoint' }));
}).listen(8792, '127.0.0.1');
