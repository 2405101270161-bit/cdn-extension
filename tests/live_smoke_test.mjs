/**
 * Live Website Smoke-Testing Harness
 * Connects to the 5 smoke-test targets (google.com, flipkart.com, cloudflare.com, amazon.com, github.com),
 * captures their live HTTP/HTTPS response headers, socket connection IPs, timings, and redirect paths,
 * and passes the captured evidence through the extension's detection and metric modules.
 */

import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import {
    detectCdnProvider,
    extractEdgeEvidence,
    analyzeCacheDetails,
    detectResourceCdn
} from '../modules/cdn.js';
import { calculateMetrics } from '../modules/metrics.js';
import { analyzeResources } from '../modules/resources.js';
import { calculatePerformanceScore } from '../modules/scoring.js';

const TARGETS = [
    'https://www.google.com',
    'https://www.flipkart.com',
    'https://www.cloudflare.com',
    'https://www.amazon.com',
    'https://github.com'
];

async function inspectLiveTarget(targetUrl) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        let dnsTime = null;
        let tcpTime = null;
        let tlsTime = null;
        let ttfbTime = null;
        let downloadTime = null;

        let dnsStart = null;
        let connectStart = null;
        let secureConnectStart = null;

        const parsedUrl = new URL(targetUrl);
        const req = https.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br, zstd'
            },
            timeout: 10000
        }, (res) => {
            ttfbTime = Date.now() - startTime;
            const remoteIp = res.socket?.remoteAddress || null;
            const remotePort = res.socket?.remotePort || null;
            const protocol = res.httpVersion ? `http/${res.httpVersion}` : 'http/1.1';

            let bodySize = 0;
            res.on('data', (chunk) => { bodySize += chunk.length; });
            res.on('end', () => {
                downloadTime = Date.now() - (startTime + ttfbTime);
                const totalDuration = Date.now() - startTime;

                const headers = {};
                for (const [k, v] of Object.entries(res.headers)) {
                    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
                }

                // Analyze via modules
                const cdn = detectCdnProvider(headers);
                const edge = extractEdgeEvidence(headers, cdn.provider, remoteIp, remotePort);
                const cache = analyzeCacheDetails(headers);

                // Resource mock
                const requestsMap = new Map();
                requestsMap.set('main', {
                    url: targetUrl,
                    type: 'Document',
                    requestWillBeSentTime: 0,
                    responseReceivedTime: ttfbTime,
                    loadingFinishedTime: totalDuration,
                    encodedDataLength: bodySize,
                    response: {
                        status: res.statusCode,
                        protocol,
                        remoteIPAddress: remoteIp,
                        headers
                    }
                });

                const resources = analyzeResources(targetUrl, requestsMap);
                const score = calculatePerformanceScore({
                    isHttps: true,
                    timing: { ttfbMs: ttfbTime, loadEventMs: totalDuration, documentMs: totalDuration },
                    cacheStatus: cache.summary,
                    headers,
                    failedRequestCount: 0,
                    protocol
                });

                resolve({
                    requestedUrl: targetUrl,
                    finalUrl: res.headers.location || targetUrl,
                    statusCode: res.statusCode,
                    remoteIp,
                    remotePort,
                    protocol,
                    timings: {
                        dnsMs: dnsTime,
                        tcpMs: tcpTime,
                        tlsMs: tlsTime,
                        ttfbMs: ttfbTime,
                        downloadMs: Math.max(0, downloadTime),
                        totalDurationMs: totalDuration
                    },
                    bodyBytes: bodySize,
                    cdn: {
                        provider: cdn.provider,
                        confidence: cdn.confidence,
                        evidence: cdn.evidence
                    },
                    edge: {
                        edgePop: edge.edgePop,
                        popCode: edge.popCode,
                        availability: edge.availability,
                        evidenceSource: edge.evidenceSource
                    },
                    cache: {
                        summary: cache.summary,
                        cdnCacheStatus: cache.cdnCache.status,
                        policyStatus: cache.policy.status,
                        cacheControl: cache.policy.cacheControl,
                        ageSeconds: cache.policy.ageSeconds
                    },
                    score: score.score,
                    grade: score.grade,
                    completionReason: 'Response complete (200 OK or Redirect)',
                    errors: null
                });
            });
        });

        req.on('socket', (socket) => {
            dnsStart = Date.now();
            socket.on('lookup', () => { dnsTime = Date.now() - dnsStart; });
            socket.on('connect', () => { connectStart = Date.now(); tcpTime = connectStart - (dnsStart + (dnsTime || 0)); });
            socket.on('secureConnect', () => { secureConnectStart = Date.now(); tlsTime = secureConnectStart - connectStart; });
        });

        req.on('error', (err) => {
            resolve({
                requestedUrl: targetUrl,
                finalUrl: targetUrl,
                statusCode: 0,
                timings: {},
                cdn: { provider: 'Not Detected', confidence: 'none', evidence: [] },
                edge: { edgePop: null, popCode: null, availability: 'unavailable' },
                cache: { summary: 'Unknown' },
                completionReason: 'Network error',
                errors: err.message
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({
                requestedUrl: targetUrl,
                finalUrl: targetUrl,
                statusCode: 0,
                timings: {},
                cdn: { provider: 'Not Detected', confidence: 'none', evidence: [] },
                edge: { edgePop: null, popCode: null, availability: 'unavailable' },
                cache: { summary: 'Unknown' },
                completionReason: 'Timeout (10s ceiling)',
                errors: 'Request timed out'
            });
        });
    });
}

console.log("==================================================================");
console.log("LIVE WEBSITES SMOKE-TESTING SUITE");
console.log("==================================================================");

const results = [];
for (const target of TARGETS) {
    console.log(`\nConnecting to: ${target}...`);
    const res = await inspectLiveTarget(target);
    results.push(res);

    console.log(`  Status: ${res.statusCode} | Protocol: ${res.protocol || 'N/A'}`);
    console.log(`  Remote IP: ${res.remoteIp || 'N/A'}`);
    console.log(`  CDN Provider: ${res.cdn.provider} (${res.cdn.confidence})`);
    if (res.cdn.evidence.length > 0) {
        console.log(`  Evidence: ${res.cdn.evidence.join('; ')}`);
    }
    console.log(`  Edge PoP: ${res.edge.edgePop || 'Not Available'} (Availability: ${res.edge.availability})`);
    console.log(`  Cache Status: ${res.cache.summary} (CDN: ${res.cache.cdnCacheStatus}, Policy: ${res.cache.policyStatus})`);
    console.log(`  TTFB: ${res.timings.ttfbMs}ms | Total Duration: ${res.timings.totalDurationMs}ms`);
    console.log(`  Performance Score: ${res.score || 'N/A'} (Grade ${res.grade || 'N/A'})`);
}

console.log("\n==================================================================");
console.log("LIVE SMOKE-TEST RESULTS SUMMARY (JSON)");
console.log("==================================================================");
console.log(JSON.stringify(results, null, 2));
