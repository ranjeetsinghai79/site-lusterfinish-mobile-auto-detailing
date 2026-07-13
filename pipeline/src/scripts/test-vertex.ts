import { geminiText, GEMINI_PRO, GEMINI_FLASH } from '../tools/gemini.js'

async function main() {
  console.log('Testing Gemini 3.1 Pro on Vertex...')
  const pro = await geminiText('Say exactly: "Gemini 3.1 Pro on Vertex working"', { model: GEMINI_PRO })
  console.log('PRO:', pro.trim())

  console.log('Testing Gemini 3.1 Flash on Vertex...')
  const flash = await geminiText('Say exactly: "Gemini 3.1 Flash on Vertex working"', { model: GEMINI_FLASH })
  console.log('FLASH:', flash.trim())

  console.log('\nAll Vertex AI text models OK ✓')
}

main().catch(e => { console.error(e); process.exit(1) })
