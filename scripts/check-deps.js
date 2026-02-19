import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

const sharedModules = '/vercel/share/v0-next-shadcn/node_modules';
const projectModules = '/vercel/share/v0-project/node_modules';

console.log('=== Shared node_modules ===');
console.log('Exists:', existsSync(sharedModules));

if (existsSync(sharedModules)) {
  try {
    const dirs = readdirSync(sharedModules).filter(d => !d.startsWith('.'));
    console.log('Top-level packages:', dirs.length);
    
    // Check key packages
    const keyPkgs = ['tailwindcss', 'lucide-react', 'next', 'react', 'react-dom'];
    for (const pkg of keyPkgs) {
      const pkgPath = join(sharedModules, pkg);
      console.log(`  ${pkg}: ${existsSync(pkgPath)}`);
    }
    
    // Check @radix-ui
    const radixPath = join(sharedModules, '@radix-ui');
    if (existsSync(radixPath)) {
      const radixPkgs = readdirSync(radixPath);
      console.log('  @radix-ui packages:', radixPkgs.length);
      console.log('  Has react-label:', radixPkgs.includes('react-label'));
    }
  } catch (e) {
    console.log('Error reading shared modules:', e.message);
  }
}

// Check .pnpm store
const pnpmStore = join(sharedModules, '.pnpm');
if (existsSync(pnpmStore)) {
  try {
    const allDirs = readdirSync(pnpmStore);
    const tailwindDirs = allDirs.filter(d => d.startsWith('tailwindcss@'));
    const lucideDirs = allDirs.filter(d => d.startsWith('lucide-react@'));
    const labelDirs = allDirs.filter(d => d.includes('react-label'));
    console.log('\n=== .pnpm store ===');
    console.log('tailwindcss versions:', tailwindDirs);
    console.log('lucide-react versions:', lucideDirs);
    console.log('react-label versions:', labelDirs);
  } catch(e) {
    console.log('Error reading .pnpm:', e.message);
  }
}

console.log('\n=== Project node_modules ===');
console.log('Exists:', existsSync(projectModules));
if (existsSync(projectModules)) {
  try {
    const dirs = readdirSync(projectModules).filter(d => !d.startsWith('.'));
    console.log('Top-level packages:', dirs.length);
    
    const keyPkgs = ['tailwindcss', 'lucide-react', 'next', 'react'];
    for (const pkg of keyPkgs) {
      console.log(`  ${pkg}: ${existsSync(join(projectModules, pkg))}`);
    }
    
    const projPnpm = join(projectModules, '.pnpm');
    if (existsSync(projPnpm)) {
      const projDirs = readdirSync(projPnpm);
      const twDirs = projDirs.filter(d => d.startsWith('tailwindcss@'));
      const lucDirs = projDirs.filter(d => d.startsWith('lucide-react@'));
      console.log('Project .pnpm tailwindcss:', twDirs);
      console.log('Project .pnpm lucide-react:', lucDirs);
    }
  } catch(e) {
    console.log('Error reading project modules:', e.message);
  }
}
