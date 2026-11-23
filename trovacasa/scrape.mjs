// Entry point scraper trovacasa.it.
// Uso: node trovacasa/scrape.mjs [--headless] [--max-ads N] [--resume file] [--no-poi] [--no-geocode]
import { runPortal } from '../core/runner.mjs';
import adapter from './adapter.mjs';

runPortal(adapter, import.meta.url, process.argv.slice(2));