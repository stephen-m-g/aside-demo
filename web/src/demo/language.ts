// Demo build only: the small amount of "AI" the demo needs, done with plain rules instead of a model.
// Speech cleanup removes fillers and repeats (like the real refine step, which only makes safe edits),
// and a biology glossary supplies key terms, definitions and annotation labels.

/** term -> short student-facing definition. Order matters for labels: more specific terms first. */
export const GLOSSARY: Record<string, string> = {
  'ATP synthase': 'The enzyme in the inner mitochondrial membrane that uses the flow of hydrogen ions to make ATP.',
  'electron transport chain': 'Proteins in the inner mitochondrial membrane that pass electrons along and pump hydrogen ions, powering most ATP production.',
  'Krebs cycle': 'A cycle of reactions in the mitochondrial matrix that breaks down pyruvate, releasing CO₂ and loading NADH and FADH₂.',
  'cellular respiration': 'How cells release the energy stored in glucose as ATP, using oxygen and giving off carbon dioxide and water.',
  'inner membrane': 'The folded membrane inside the mitochondrion where the electron transport chain and ATP synthase sit.',
  'outer membrane': 'The smooth membrane that encloses the mitochondrion.',
  'intermembrane space': 'The narrow space between the two mitochondrial membranes, where hydrogen ions build up.',
  cristae: 'The folds of the inner mitochondrial membrane; they add surface area for making ATP.',
  matrix: 'The fluid inside the inner mitochondrial membrane, where the Krebs cycle happens.',
  mitochondria: 'Organelles that carry out most of cellular respiration and make most of the cell’s ATP.',
  mitochondrion: 'An organelle that carries out most of cellular respiration and makes most of the cell’s ATP.',
  glycolysis: 'The first stage of respiration, in the cytoplasm: glucose is split into two pyruvate, making 2 ATP.',
  pyruvate: 'The three-carbon molecule glycolysis makes from glucose; it moves into the mitochondrion.',
  glucose: 'A six-carbon sugar (C₆H₁₂O₆), the main fuel for cellular respiration.',
  ATP: 'Adenosine triphosphate, the molecule cells use to carry and spend energy.',
  NADH: 'An electron carrier that brings high-energy electrons to the electron transport chain.',
  oxygen: 'The final electron acceptor in the electron transport chain; it combines with hydrogen to form water.',
  'carbon dioxide': 'A waste product of the Krebs cycle that we breathe out.',
  cytoplasm: 'The jelly-like inside of the cell, outside the nucleus, where glycolysis happens.',
  nucleus: 'The organelle that holds the cell’s DNA.',
  ribosomes: 'Small structures that build proteins.',
  'Golgi apparatus': 'The organelle that packages and ships proteins.',
  'cell membrane': 'The flexible boundary that controls what enters and leaves the cell.',
  photosynthesis: 'How plants use light energy to make glucose from carbon dioxide and water, releasing oxygen.',
  chloroplast: 'The organelle in plant cells where photosynthesis happens.',
  thylakoid: 'Flattened sacs in the chloroplast where the light reactions happen.',
  granum: 'A stack of thylakoids in a chloroplast.',
  stroma: 'The fluid in the chloroplast where the Calvin cycle builds sugar.',
  chlorophyll: 'The green pigment that absorbs light for photosynthesis.',
  'Calvin cycle': 'Reactions in the stroma that use ATP and NADPH to build sugar from carbon dioxide.',
  allele: 'One version of a gene.',
  dominant: 'An allele that shows its trait even when only one copy is present.',
  recessive: 'An allele whose trait shows only when two copies are present.',
  genotype: 'The alleles an organism has, like Bb.',
  phenotype: 'The trait you can observe, like eye color.',
  'Punnett square': 'A grid that predicts the possible offspring of a cross.',
  heterozygous: 'Having two different alleles for a gene, like Bb.',
  homozygous: 'Having two identical alleles for a gene, like BB or bb.',
}

const TERMS = Object.keys(GLOSSARY)

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const termPattern = (term: string) => new RegExp(`\\b${escape(term)}\\b`, 'i')

/** Glossary terms mentioned in the text, in the order they first appear (no overlaps, e.g. "inner membrane" wins over "membrane"). */
export function findTerms(text: string): string[] {
  const hits: { term: string; at: number }[] = []
  for (const term of TERMS) {
    const m = termPattern(term).exec(text)
    if (!m) continue
    const end = m.index + m[0].length
    if (hits.some((h) => m.index < h.at + h.term.length && h.at < end)) continue
    hits.push({ term, at: m.index })
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.term)
}

export function keyTerms(text: string, max = 4) {
  return findTerms(text)
    .slice(0, max)
    .map((term) => ({ term: term[0].toUpperCase() + term.slice(1), definition: GLOSSARY[term] }))
}

const FILLERS = /\b(?:um+|uh+|erm|ah+|hmm+|you know|i mean|sort of|kind of|okay so|so yeah)\b[,.]?\s*/gi
const SOUND_ALIKES: [RegExp, string][] = [
  [/\ba tee pee\b/gi, 'ATP'],
  [/\ba t p\b/gi, 'ATP'],
  [/\bcrebs\b/gi, 'Krebs'],
  [/\bmight a? ?condria\b/gi, 'mitochondria'],
  [/\bc o two\b/gi, 'CO₂'],
]

/** Safe cleanup of one spoken utterance: drop fillers and stutters, fix sound-alikes, tidy punctuation. */
export function cleanSpeech(raw: string): string {
  let t = ` ${raw} `
  for (const [re, to] of SOUND_ALIKES) t = t.replace(re, to)
  t = t.replace(FILLERS, '')
  t = t.replace(/\b(\w+)(\s+\1\b)+/gi, '$1') // "the the" -> "the"
  t = t.replace(/\s+([,.!?;:])/g, '$1').replace(/([,.!?;:])(?=[A-Za-z])/g, '$1 ')
  t = t.replace(/\s{2,}/g, ' ').trim()
  t = t.replace(/^[,.;:]\s*/, '')
  if (!t) return ''
  t = t.replace(/(^|[.!?]\s+)([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase())
  if (!/[.!?]$/.test(t)) t += '.'
  return t
}

/** "cell_diagram-v2.png" -> "Cell diagram v2" */
export function labelFromFileName(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  return base ? base[0].toUpperCase() + base.slice(1) : 'Untitled file'
}

export function firstSentence(text: string, maxWords = 24): string {
  const s = text.trim().split(/(?<=[.!?])\s+/)[0] ?? ''
  const words = s.split(/\s+/)
  return words.length > maxWords ? words.slice(0, maxWords).join(' ') + '…' : s
}

export function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}
