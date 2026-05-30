import { execSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline';

const rl = createInterface({ input, output });

const TEMPLATES: Record<string, { url: string; name: string; isEditor: boolean }> = {
  linux: {
    url: 'https://github.com/godotjs/GodotJS/releases/download/v1.1.0-pre-godot46rc3/linux-template_release-4.6.1-v8.zip',
    name: 'Linux',
    isEditor: true,
  },
  windows: {
    url: 'https://github.com/godotjs/GodotJS/releases/download/v1.1.0-pre-godot46rc3/windows-template_release-4.6.1-v8.zip',
    name: 'Windows',
    isEditor: true,
  },
  macos: {
    url: 'https://github.com/godotjs/GodotJS/releases/download/v1.1.0-pre-godot46rc3/macos-template-app-4.6.1-v8.zip',
    name: 'macOS',
    isEditor: true,
  },
  web: {
    url: 'https://github.com/godotjs/GodotJS/releases/download/v1.1.0-pre-godot46rc3/web-template_release-4.6.1-browser.zip',
    name: 'Web',
    isEditor: false,
  },
};

const args = process.argv.slice(2);
const isAll = args.includes('--all');
const isList = args.includes('--list');
const isForce = args.includes('--force');
const selected = args
  .filter((a) => a.startsWith('--'))
  .filter((a) => !['--all', '--list', '--force'].includes(a))
  .map((a) => a.replace('--', ''));

function getPlatform(): string {
  const platform = process.platform;
  if (platform === 'linux') return 'linux';
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

async function question(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(promptText, resolve);
  });
}

async function download(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, (response) => {
        if (response.statusCode === 302 && response.headers.location) {
          https
            .get(response.headers.location, (redirectResponse) => {
              redirectResponse.pipe(file);
              file.on('close', resolve);
            })
            .on('error', reject);
        } else {
          response.pipe(file);
          file.on('close', resolve);
        }
      })
      .on('error', reject);
  });
}

function getTargetPath(key: string): string {
  if (key === 'linux')
    return 'templates/linux-template_release-4.6.1-v8/godot.linuxbsd.editor.x86_64';
  if (key === 'windows')
    return 'templates/windows-template_release-4.6.1-v8/godot.windows.template.x86_64.exe';
  if (key === 'macos') return 'templates/macos-template-app-4.6.1-v8/Game.app/Contents/MacOS/Game';
  return `templates/${key}`;
}

function hasTemplate(key: string): boolean {
  if (isForce) return false;
  const path = getTargetPath(key);
  return fs.existsSync(path);
}

function downloadTemplate(key: string): Promise<void> {
  const tmpl = TEMPLATES[key];

  if (!isForce && hasTemplate(key)) {
    return;
  }

  const zipPath = `templates/${key}.zip`;

  if (!fs.existsSync('templates/')) {
    fs.mkdirSync('templates/', { recursive: true });
  }

  const syncDownload = () => {
    const file = fs.createWriteSync(zipPath);
    const protocol = tmpl.url.startsWith('https') ? require('node:https') : require('node:http');
    return new Promise<void>((resolve, reject) => {
      protocol
        .get(tmpl.url, (response) => {
          if (response.statusCode === 302 && response.headers.location) {
            https
              .get(response.headers.location, (redirect) => {
                redirect.pipe(file);
                file.on('close', resolve);
              })
              .on('error', reject);
          } else {
            response.pipe(file);
            file.on('close', resolve);
          }
        })
        .on('error', reject);
    });
  };

  // Use sync download for simplicity
  const http = require('node:http');
  const https = require('node:https');

  const urlObj = new URL(tmpl.url);
  const client = urlObj.protocol === 'https:' ? https : http;

  return new Promise<void>((resolve, reject) => {
    client
      .get(tmpl.url, (response: any) => {
        if (response.statusCode === 302 && response.headers.location) {
          client
            .get(response.headers.location, (redirect: any) => {
              const file = fs.createWriteStream(zipPath);
              redirect.pipe(file);
              file.on('close', resolve);
            })
            .on('error', reject);
        } else {
          const file = fs.createWriteStream(zipPath);
          response.pipe(file);
          file.on('close', resolve);
        }
      })
      .on('error', reject);
  }).then(() => {
    const targetDir = `templates/${key}`;
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true });
    }

    execSync(`python3 -c "import zipfile; zipfile.ZipFile('${zipPath}').extractall('templates/')"`);

    // Find the extracted directory
    const entries = fs.readdirSync('templates/');
    const extracted = entries.find((e) => {
      try {
        const stat = fs.lstatSync(`templates/${e}`);
        return stat.isDirectory() && e.includes(key) && !e.endsWith('.zip');
      } catch {
        return false;
      }
    });

    const dirName = extracted || key;

    if (tmpl.isEditor) {
      const binPath = `templates/${dirName}/godot.linuxbsd.editor.x86_64`;
      if (fs.existsSync(binPath)) {
        fs.chmodSync(binPath, 0o755);
      }
    } else {
      const templateDir = `${process.env.HOME}/.local/share/godot/export_templates/4.6.1.stable`;
      if (!fs.existsSync(templateDir)) {
        fs.mkdirSync(templateDir, { recursive: true });
      }

      const wasmZip = fs.readdirSync(`templates/${dirName}`).find((f) => f.endsWith('.zip'));
      if (wasmZip) {
        fs.copyFileSync(`templates/${dirName}/${wasmZip}`, `${templateDir}/web_release.zip`);
        fs.copyFileSync(
          `templates/${dirName}/${wasmZip}`,
          `${templateDir}/web_nothreads_release.zip`,
        );
      }
    }

    try {
      fs.unlinkSync(zipPath);
    } catch {
      // ignore
    }
  });
}

async function main() {
  if (isList) {
    return;
  }

  let toDownload = selected;
  if (toDownload.length === 0 && !isAll) {
    const defaultPlat = getPlatform();
    const answer = await question(`Download? [Y] for ${defaultPlat} + web, [A] all, or list: `);

    if (answer.toLowerCase() === 'a') {
      toDownload = Object.keys(TEMPLATES);
    } else if (answer.toLowerCase() === 'y' || answer === '') {
      toDownload = [defaultPlat, 'web'];
    } else if (answer.includes(',')) {
      toDownload = answer.split(',').map((s) => s.trim());
    } else {
      toDownload = [answer.trim()];
    }
  }

  if (isAll) {
    toDownload = Object.keys(TEMPLATES);
  }

  for (const key of toDownload) {
    if (!TEMPLATES[key]) {
      continue;
    }
    await downloadTemplate(key);
  }
  rl.close();
}

main().catch(console.error);
