#!/bin/bash
# HTTP CONNECT to SOCKS5 bridge
cd "$(dirname "$0")"

node --eval "
const http = require('http');
const https = require('https');
const { SocksProxyAgent } = require('socks-proxy-agent/socks-proxy-agent.js');

const SOCKS_PROXY = 'socks5://127.0.0.1:7890';
const LOCAL_PORT = 7891;

const server = http.createServer();

server.on('connect', (req, clientSocket, head) => {
  const url = new URL('http://' + req.url);
  const port = url.port || 443;
  const hostname = url.hostname;

  const socksAgent = new SocksProxyAgent(SOCKS_PROXY);

  const options = { port, host: hostname, agent: socksAgent };

  const serverSocket = require('net').createConnection(options, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', () => clientSocket.end());
  clientSocket.on('error', () => serverSocket.end());
});

server.on('request', (req, res) => {
  const socksAgent = new SocksProxyAgent(SOCKS_PROXY);
  const url = new URL(req.url);

  const options = {
    host: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: req.method,
    headers: req.headers,
    agent: socksAgent,
  };

  const protocol = url.protocol === 'https:' ? https : http;
  const proxyReq = protocol.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    res.writeHead(502);
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
});

server.listen(LOCAL_PORT, '127.0.0.1', () => {
  console.log('[bridge] CONNECT-to-SOCKS listening on http://127.0.0.1:' + LOCAL_PORT);
});
" &
echo "Bridge started"
