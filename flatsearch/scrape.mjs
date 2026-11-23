// Entry point: node flatsearch/scrape.mjs [--headless] [--max-ads N] [--no-poi] [--resume]
import { runPortal } from '../core/runner.mjs';
import adapter from './adapter.mjs';
runPortal(adapter, import.meta.url, process.argv.slice(2));