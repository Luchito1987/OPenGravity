import fs from 'fs';
import mammoth from 'mammoth';

async function test() {
  try {
    const file = process.argv[2];
    if (!file) {
      console.log('Provide a file to test');
      return;
    }
    console.log('Testing', file);
    const buffer = fs.readFileSync(file);
    const result = await mammoth.extractRawText({ buffer });
    console.log('Result length:', result.value.length);
    console.log('First 100 chars:', result.value.substring(0, 100));
  } catch (e) {
    console.error('Crash:', e);
  }
}
test();
