// Proxy preload - must be loaded before any other modules
import { bootstrap } from 'global-agent';

// Set the proxy URL before bootstrapping
process.env.GLOBAL_AGENT_HTTP_PROXY = process.env.https_proxy || process.env.HTTPS_PROXY || 'http://127.0.0.1:7890';

// Bootstrap global-agent to patch all HTTP requests
bootstrap();

console.log('[proxy-preload] Global agent bootstrapped with proxy:', process.env.GLOBAL_AGENT_HTTP_PROXY);
