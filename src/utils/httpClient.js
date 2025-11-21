import axios from "axios";
import http from "http";
import https from "https";

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

export const httpClient = axios.create({
  timeout: 15000,
  headers: { "User-Agent": "Mozilla/5.0 (Node.js Scraper)" },
  httpAgent,
  httpsAgent,
  maxRedirects: 3,
  validateStatus: (s) => s < 500, // treat 4xx as valid responses to parse
});
