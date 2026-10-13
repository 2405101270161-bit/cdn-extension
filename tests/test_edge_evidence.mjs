/**
 * Test Suite: Edge-Server Evidence & Identification
 * Verifies edge-server PoP extraction, remote IP separation, absence of fabricated locations,
 * and decoupling of provider detection from physical edge server identity.
 */

import assert from 'node:assert';
import { extractEdgeEvidence, detectCdnProvider } from '../modules/cdn.js';

console.log("=================================================");
console.log("Test Suite: Edge-Server Evidence & Identification");
console.log("=================================================");

let passed = 0;
let total = 0;

function test(name, fn) {
    total++;
    try {
        fn();
        console.log(`  PASS: [EDGE-EV-${total}] ${name}`);
        passed++;
    } catch (err) {
        console.error(`  FAIL: [EDGE-EV-${total}] ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

// 1. Cloudflare cf-ray with standard IATA 3-letter airport code suffix
test("Cloudflare cf-ray with location suffix extracts edgePop and popCode", () => {
    const edge = extractEdgeEvidence({
        'cf-ray': '8f3bc4928b971234-IAD'
    }, 'Cloudflare', '104.21.5.12', 443);

    assert.strictEqual(edge.edgePop, 'IAD');
    assert.strictEqual(edge.popCode, 'IAD');
    assert.strictEqual(edge.remoteIp, '104.21.5.12');
    assert.strictEqual(edge.evidenceSource, 'cf-ray');
    assert.strictEqual(edge.availability, 'available');
    assert.strictEqual(edge.confidence, 'high');
});

// 2. Cloudflare cf-ray without location suffix
test("Cloudflare cf-ray without location suffix preserves request identifier without guessing PoP", () => {
    const edge = extractEdgeEvidence({
        'cf-ray': '8f3bc4928b971234'
    }, 'Cloudflare', '104.21.5.12', 443);

    assert.strictEqual(edge.requestIdentifier, '8f3bc4928b971234');
    assert.strictEqual(edge.popCode, null, "Do not guess a PoP airport code when no location suffix exists");
    assert.strictEqual(edge.remoteIp, '104.21.5.12');
});

// 3. CloudFront x-amz-cf-pop identifier
test("Amazon CloudFront x-amz-cf-pop extracts full node and 3-letter IATA code", () => {
    const edge = extractEdgeEvidence({
        'x-amz-cf-pop': 'DFW50-C2',
        'x-amz-cf-id': 'c03Z89abcdef12345678=='
    }, 'Amazon CloudFront', '13.224.10.45', 443);

    assert.strictEqual(edge.edgePop, 'DFW50-C2');
    assert.strictEqual(edge.popCode, 'DFW');
    assert.strictEqual(edge.requestIdentifier, 'c03Z89abcdef12345678==');
    assert.strictEqual(edge.evidenceSource, 'x-amz-cf-pop');
    assert.strictEqual(edge.availability, 'available');
});

// 4. Fastly x-served-by with multi-hop cache nodes
test("Fastly x-served-by extracts final delivery edge node and popCode", () => {
    const edge = extractEdgeEvidence({
        'x-served-by': 'cache-bwi5120-BWI, cache-iad-kiad12345-IAD',
        'x-fastly-request-id': '76543210abcdef'
    }, 'Fastly', '151.101.1.67', 443);

    assert.strictEqual(edge.edgePop, 'cache-iad-kiad12345-IAD');
    assert.strictEqual(edge.popCode, 'IAD');
    assert.strictEqual(edge.requestIdentifier, '76543210abcdef');
    assert.strictEqual(edge.evidenceSource, 'x-served-by');
});

// 5. Akamai diagnostic request ID and GRN
test("Akamai akamai-grn and request ID recorded without fabricating physical location", () => {
    const edge = extractEdgeEvidence({
        'akamai-grn': '0.12345.6789.abcdef',
        'x-akamai-request-id': '9876543'
    }, 'Akamai', '23.45.67.89', 443);

    assert.strictEqual(edge.requestIdentifier, '0.12345.6789.abcdef');
    assert.strictEqual(edge.popCode, null, "Akamai GRN/Request-ID is not a physical airport code");
    assert.strictEqual(edge.evidenceSource, 'akamai-grn');
});

// 6. Vercel x-vercel-id
test("Vercel x-vercel-id extracts edge region identifier", () => {
    const edge = extractEdgeEvidence({
        'x-vercel-id': 'sfo1::sfo1::12345-67890'
    }, 'Vercel', '76.76.21.21', 443);

    assert.strictEqual(edge.edgePop, 'sfo1');
    assert.strictEqual(edge.popCode, 'SFO');
    assert.strictEqual(edge.evidenceSource, 'x-vercel-id');
});

// 7. CDN77 x-77-pop
test("CDN77 x-77-pop extracts edge location", () => {
    const edge = extractEdgeEvidence({
        'x-77-pop': 'fra'
    }, 'CDN77', '185.229.56.1', 443);

    assert.strictEqual(edge.edgePop, 'fra');
    assert.strictEqual(edge.evidenceSource, 'x-77-pop');
});

// 8. KeyCDN x-edge-location
test("KeyCDN x-edge-location extracts edge PoP", () => {
    const edge = extractEdgeEvidence({
        'x-edge-location': 'usla'
    }, 'KeyCDN', '185.172.148.1', 443);

    assert.strictEqual(edge.edgePop, 'usla');
    assert.strictEqual(edge.evidenceSource, 'x-edge-location');
});

// 9. BunnyCDN b-ray
test("BunnyCDN b-ray extracts edge identifier", () => {
    const edge = extractEdgeEvidence({
        'b-ray': '123456-iad'
    }, 'BunnyCDN', '198.51.100.2', 443);

    assert.strictEqual(edge.edgePop, '123456-iad');
    assert.strictEqual(edge.evidenceSource, 'b-ray');
});

// 10. Remote IP present without any edge PoP headers
test("Remote IP alone records socket metadata but marks edge location unavailable", () => {
    const edge = extractEdgeEvidence({
        'server': 'Apache'
    }, 'Not Detected', '198.51.100.50', 80);

    assert.strictEqual(edge.remoteIp, '198.51.100.50');
    assert.strictEqual(edge.remotePort, 80);
    assert.strictEqual(edge.edgePop, null);
    assert.strictEqual(edge.popCode, null);
    assert.strictEqual(edge.evidenceSource, 'socket-remote-ip');
    assert.strictEqual(edge.availability, 'unavailable');
    assert.strictEqual(edge.confidence, 'low');
    assert.ok(edge.limitations.some(l => l.includes('not exposed')));
});

// 11. Provider detected but edge location unavailable
test("Provider detected (e.g. via server or via header) does not imply PoP is known", () => {
    const cdn = detectCdnProvider({
        'server': 'cloudflare'
    });
    assert.strictEqual(cdn.provider, 'Cloudflare');

    const edge = extractEdgeEvidence({
        'server': 'cloudflare'
    }, cdn.provider, '104.21.5.12', 443);

    assert.strictEqual(edge.edgePop, null, "PoP must remain null when cf-ray is absent");
    assert.strictEqual(edge.popCode, null);
    assert.strictEqual(edge.remoteIp, '104.21.5.12');
    assert.strictEqual(edge.availability, 'unavailable');
});

// 12. Malformed or empty edge headers
test("Malformed or whitespace-only edge headers are safely ignored", () => {
    const edge = extractEdgeEvidence({
        'cf-ray': '   ',
        'x-amz-cf-pop': '',
        'x-served-by': null
    }, 'Not Detected', null, null);

    assert.strictEqual(edge.edgePop, null);
    assert.strictEqual(edge.popCode, null);
    assert.strictEqual(edge.availability, 'unavailable');
});

// 13. Decoupling verification: remote IP and edge location remain separate fields
test("Remote IP and edge location remain strictly separated in evidence schema", () => {
    const edge = extractEdgeEvidence({
        'x-amz-cf-pop': 'LHR50-C1'
    }, 'Amazon CloudFront', '13.224.50.100', 443);

    assert.strictEqual(edge.edgePop, 'LHR50-C1');
    assert.strictEqual(edge.remoteIp, '13.224.50.100');
    assert.notStrictEqual(edge.edgePop, edge.remoteIp);
});

console.log("=================================================");
console.log(`Results: ${passed} of ${total} Edge Evidence tests passed.`);
console.log("=================================================");
