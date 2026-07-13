import 'dotenv/config'
import { runPipeline } from './orchestrator.js'
import type { PipelineConfig } from './types.js'

const config: PipelineConfig = {
  niche: (process.env.NICHE as PipelineConfig['niche']) || 'hvac',
  location: process.env.LOCATION || 'Tracy, CA',
  city: process.env.CITY || 'Tracy',
  state: process.env.STATE || 'CA',
  count: parseInt(process.env.COUNT || '10'),
  templateOwner: process.env.TEMPLATE_OWNER || 'ranjeetsinghai79',
  templateRepo: process.env.TEMPLATE_REPO || 'websitedeveloper',
  deployOwner: process.env.DEPLOY_OWNER || 'ranjeetsinghai79',
  dryRun: process.env.DRY_RUN === 'true',
}

runPipeline(config).catch(console.error)
