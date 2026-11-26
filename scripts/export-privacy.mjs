import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { dirname, resolve } from 'node:path';
import { privacyPolicySections, privacyPolicyUpdated } from '../src/content/privacyPolicy.ts';

try { loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const contact = process.env.EXPO_PUBLIC_PRIVACY_CONTACT_EMAIL?.trim() ?? '';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) || /example\.(com|org|net)$|\.(invalid|test|localhost)$/i.test(contact)) {
  throw new Error('Set a real EXPO_PUBLIC_PRIVACY_CONTACT_EMAIL before exporting a public policy.');
}
const outputFlag = process.argv.indexOf('--output');
const output = resolve(outputFlag < 0 ? 'docs/privacy.html' : process.argv[outputFlag + 1] ?? '');
const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const sections = privacyPolicySections(contact).map((section) => `<section><h2>${escape(section.title)}</h2>${section.paragraphs.map((paragraph) => `<p>${escape(paragraph)}</p>`).join('')}</section>`).join('\n');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Crossa Privacy Policy</title>
<style>:root{color-scheme:light dark}body{font:16px/1.65 system-ui,sans-serif;max-width:760px;padding:28px 20px;margin:auto}h1{line-height:1.2}h2{font-size:1.25rem;margin-top:2rem}p{overflow-wrap:anywhere}</style></head>
<body><main><h1>Crossa Privacy Policy</h1><p>Updated ${escape(privacyPolicyUpdated)}</p>${sections}</main></body></html>\n`;
await mkdir(dirname(output), { recursive: true });
await writeFile(output, html);
console.log(`Privacy policy exported to ${output}. Publish this page and set EXPO_PUBLIC_PRIVACY_POLICY_URL to its public HTTPS URL.`);
