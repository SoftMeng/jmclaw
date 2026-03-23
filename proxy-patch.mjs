// Proxy loader - patches HTTP to use proxy
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { ProxyAgent } from 'proxy-agent';

const proxyUri = 'http://127.0.0.1:7890';
const proxyAgent = new ProxyAgent(proxyUri);

// Patch global agents
http.globalAgent = proxyAgent;
https.globalAgent = proxyAgent;
