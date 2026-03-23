// Preload script - patches WebSocket with SOCKS5 proxy
// IMPORTANT: This must be loaded BEFORE any other module that might require 'ws'

const SocksProxyAgent = require('socks-proxy-agent');
const socksAgent = new SocksProxyAgent('socks5://127.0.0.1:7890');

// Load ws module
const ws = require('ws');

// Create a proxy-enabled WebSocket class
class ProxyWebSocket extends ws.WebSocket {
  constructor(url, protocols, options) {
    if (!options) options = {};
    if (!options.agent) {
      options.agent = socksAgent;
    }
    super(url, protocols, options);
  }
}

// Copy static properties
Object.defineProperty(ProxyWebSocket, 'CONNECTING', { value: 0 });
Object.defineProperty(ProxyWebSocket, 'OPEN', { value: 1 });
Object.defineProperty(ProxyWebSocket, 'CLOSING', { value: 2 });
Object.defineProperty(ProxyWebSocket, 'CLOSED', { value: 3 });

// Patch the ws module's WebSocket
ws.WebSocket = ProxyWebSocket;

// Update the require cache
const wsCache = require.cache[require.resolve('ws')];
if (wsCache) {
  wsCache.exports.WebSocket = ProxyWebSocket;
}

// Patch globalThis.WebSocket
globalThis.WebSocket = ProxyWebSocket;

console.log('[proxy-preload] WebSocket patched with SOCKS5 proxy');

// Patch undici for HTTP proxy
const { ProxyAgent } = require('undici');
const httpProxyAgent = new ProxyAgent('http://127.0.0.1:7890');

// Intercept Module._load to patch undici when it's first required
const Module = require('module');
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  const result = originalLoad.apply(this, arguments);

  if (request === 'undici' && result) {
    if (result.fetch && !result.fetch.__patched) {
      const originalFetch = result.fetch;
      result.fetch = function patchedFetch(url, options = {}) {
        if (!options || !options.dispatcher) {
          options = { ...options, dispatcher: httpProxyAgent };
        }
        return originalFetch.call(result, url, options);
      };
      result.fetch.__patched = true;

      if (result.request) {
        const originalRequest = result.request;
        result.request = function patchedRequest(url, options = {}) {
          if (!options || !options.dispatcher) {
            options = { ...options, dispatcher: httpProxyAgent };
          }
          return originalRequest.call(result, url, options);
        };
      }

      if (result.default) {
        result.default.fetch = result.fetch;
        result.default.request = result.request;
      }

      console.log('[proxy-preload] Undici patched with HTTP proxy');
    }
  }

  return result;
};

console.log('[proxy-preload] Module._load interception enabled');
console.log('[proxy-preload] Proxy configuration complete');
