import { $ } from 'bun';

const functionName = 'test';
const firebaseProjectId = 'agmcs2025';

console.log('Installing dependencies...');
await $`npm install --prefix dist`;

console.log(`Deploying function ${functionName} to project ${firebaseProjectId}...`);

await $`firebase deploy --only functions:${functionName} --project ${firebaseProjectId}`;

console.log('Deployment successful!');
