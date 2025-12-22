import dns from "dns/promises";

export const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export const isInternetAvailable = async () => {
  try {
    await dns.lookup("google.com");
    return true;
  } catch {
    return false;
  }
};
