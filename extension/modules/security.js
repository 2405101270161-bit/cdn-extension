export function analyzeSecurity(targetUrl, mainDocumentResponse, headers = {}) {
    const docUrl = (mainDocumentResponse && mainDocumentResponse.url) ? mainDocumentResponse.url : (targetUrl || '');

    const isHttps = docUrl.toLowerCase().startsWith('https://');

    let tlsDetails = { available: false };
    if (mainDocumentResponse && mainDocumentResponse.securityDetails) {
        const sec = mainDocumentResponse.securityDetails;
        tlsDetails = {
            available: true,
            version: sec.protocol || "TLS 1.3",
            cipher: sec.cipher || "Unknown Cipher",
            keyExchange: sec.keyExchange || null,
            keyExchangeGroup: sec.keyExchangeGroup || null,
            issuer: sec.issuer || "Unknown Issuer",
            subject: sec.subjectName || new URL(targetUrl).hostname,
            validFrom: sec.validFrom || 0,
            validTo: sec.validTo || 0
        };
    }

    const normHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
        normHeaders[k.toLowerCase()] = String(v);
    }

    const hsts = normHeaders['strict-transport-security'] || null;
    const csp = normHeaders['content-security-policy'] || null;
    const xFrameOptions = normHeaders['x-frame-options'] || null;
    const xContentTypeOptions = normHeaders['x-content-type-options'] || null;
    const referrerPolicy = normHeaders['referrer-policy'] || null;
    const permissionsPolicy = normHeaders['permissions-policy'] || normHeaders['feature-policy'] || null;
    const coep = normHeaders['cross-origin-embedder-policy'] || null;
    const coop = normHeaders['cross-origin-opener-policy'] || null;
    const corp = normHeaders['cross-origin-resource-policy'] || null;

    const headerChecks = {
        hsts: {
            present: !!hsts,
            value: hsts,
            description: hsts ? "Enforces secure HTTPS connections" : "Missing Strict-Transport-Security header"
        },
        csp: {
            present: !!csp,
            value: csp,
            description: csp ? "Content Security Policy configured" : "Missing Content-Security-Policy header"
        },
        xFrameOptions: {
            present: !!xFrameOptions,
            value: xFrameOptions,
            description: xFrameOptions ? `Clickjacking protection (${xFrameOptions})` : "Missing X-Frame-Options header"
        },
        xContentTypeOptions: {
            present: !!xContentTypeOptions,
            value: xContentTypeOptions,
            description: xContentTypeOptions ? "MIME-sniffing protection enabled" : "Missing X-Content-Type-Options header"
        },
        referrerPolicy: {
            present: !!referrerPolicy,
            value: referrerPolicy,
            description: referrerPolicy ? `Referrer Policy set to ${referrerPolicy}` : "Missing Referrer-Policy header"
        },
        permissionsPolicy: {
            present: !!permissionsPolicy,
            value: permissionsPolicy,
            description: permissionsPolicy ? "Permissions Policy defined" : "Missing Permissions-Policy header"
        },
        coep: {
            present: !!coep,
            value: coep,
            description: coep ? `Cross-Origin Embedder Policy (${coep})` : "Missing Cross-Origin-Embedder-Policy header"
        },
        coop: {
            present: !!coop,
            value: coop,
            description: coop ? `Cross-Origin Opener Policy (${coop})` : "Missing Cross-Origin-Opener-Policy header"
        },
        corp: {
            present: !!corp,
            value: corp,
            description: corp ? `Cross-Origin Resource Policy (${corp})` : "Missing Cross-Origin-Resource-Policy header"
        }
    };

    return {
        isHttps,
        tls: tlsDetails,
        headers: headerChecks
    };
}
