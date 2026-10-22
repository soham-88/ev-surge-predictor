import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, 'src');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else { 
      if (file.endsWith('.tsx')) results.push(file);
    }
  });
  return results;
}

const files = walk(srcDir);

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  
  // Replace arbitrary tailwind vars like bg-[var(--color-bg-base)] with bg-bg-base
  content = content.replace(/(bg|text|border)-\[var\(--color-([a-zA-Z0-9-]+)\)\]/g, '$1-$2');
  
  // Replace specific pixel values caught by the linter
  content = content.replace(/max-w-\[1440px\]/g, 'max-w-360');
  content = content.replace(/h-\[300px\]/g, 'h-75');
  content = content.replace(/h-\[400px\]/g, 'h-100');
  
  fs.writeFileSync(file, content, 'utf8');
  console.log(`Processed ${path.basename(file)}`);
});
