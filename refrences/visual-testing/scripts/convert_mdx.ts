import fs from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const folderPath = resolve(scriptsDirectory, '../src/content/help-articles');

async function processMarkdownFiles() {
  try {
    const files = await fs.readdir(folderPath);
    const mdFiles = files.filter((file) => extname(file).toLowerCase() === '.md');

    if (mdFiles.length === 0) {
      return;
    }

    for (const mdFile of mdFiles) {
      const filePath = join(folderPath, mdFile);
      let content = await fs.readFile(filePath, 'utf-8');
      const newFilePath = join(folderPath, `${basename(mdFile, '.md')}.mdx`);

      let imageFound = false;

      // 1. Replace the markdown image syntax
      const imageRegex = /!\[(.*?)\]\(\.\.\/\.\.\/assets\/help-articles\/(.*?)\)/g;
      content = content.replace(imageRegex, (_match, altText, imagePath) => {
        imageFound = true; // Set flag to true if a match is found
        return `<DynamicImage\n\taltText="${altText}"\n\timagePath="help-articles/${imagePath}"\n/>`;
      });

      // 2. Add the import statement only if an image was found
      if (imageFound) {
        const frontmatterEnd = content.indexOf('---', 3); // Find the second '---'
        if (frontmatterEnd !== -1) {
          const importStatement = "\nimport DynamicImage from '@components/dynamic-image.astro';";
          content = `${content.slice(0, frontmatterEnd + 3)}\n${importStatement}${content.slice(frontmatterEnd + 3)}`;
        }
      }

      // 3. Write the new .mdx file
      await fs.writeFile(newFilePath, content, 'utf-8');

      // 4. Delete the old .md file
      await fs.unlink(filePath);
    }
  } catch (_error) {
    /* intentionally empty */
  }
}

processMarkdownFiles();
