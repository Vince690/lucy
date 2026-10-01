#!/usr/bin/env node
/**
 * Met à jour EXPO_PUBLIC_LUCY_BACKEND_URL dans .env avec l'IP LAN actuelle du Mac,
 * pour éviter les échecs silencieux (timeout) quand l'IP a changé (DHCP, reconnexion Wi-Fi...).
 * Ne touche qu'aux URLs pointant déjà vers une IP privée (192.168.x, 10.x, 172.16-31.x) — jamais
 * localhost ni une URL de prod.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');
const PRIVATE_IP_URL_RE = /^(https?:\/\/)(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+.*)$/;

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

function main() {
  if (!fs.existsSync(ENV_PATH)) return;

  const lanIp = getLanIp();
  if (!lanIp) {
    console.warn('[sync-lan-ip] Aucune IP LAN détectée — .env inchangé.');
    return;
  }

  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  let changed = false;

  const nextLines = lines.map((line) => {
    const match = line.match(/^(EXPO_PUBLIC_LUCY_BACKEND_URL=)(.*)$/);
    if (!match) return line;

    const [, prefix, url] = match;
    const urlMatch = url.match(PRIVATE_IP_URL_RE);
    if (!urlMatch) return line; // localhost ou URL de prod : on ne touche pas

    const [, scheme, currentIp, rest] = urlMatch;
    if (currentIp === lanIp) return line;

    changed = true;
    console.log(`[sync-lan-ip] IP mise à jour : ${currentIp} → ${lanIp}`);
    return `${prefix}${scheme}${lanIp}${rest}`;
  });

  if (changed) {
    fs.writeFileSync(ENV_PATH, nextLines.join('\n'));
  } else {
    console.log(`[sync-lan-ip] IP déjà à jour (${lanIp}).`);
  }
}

main();
