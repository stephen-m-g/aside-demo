// Demo build only: what the "sample lecture" voice says. Lines are written the way people talk (lowercase,
// fillers, sound-alikes like "a tee pee") so the board's cleanup step has something to do.
import { GLOSSARY } from './language'

const RESPIRATION = [
  'okay everyone let us get started um today is all about how cells get their energy',
  'every cell needs a steady supply of a tee pee and the way it makes it is cellular respiration',
  'if you look at the cell most of this happens inside the mitochondria',
  'the first step is glycolysis and it happens out in the cytoplasm it splits glucose into two pyruvate',
  'that only gives us two ATP so uh not a great deal',
  'then the pyruvate moves into the mitochondrion and goes through the crebs cycle in the matrix',
  'the crebs cycle gives off carbon dioxide which is what you breathe out',
  'the big payoff is the electron transport chain on the inner membrane',
  'that is where oxygen comes in and where most of the ATP gets made about thirty two of them',
  'the folds of the inner membrane the cristae give it way more room to work',
  'quick check who can tell me why we need oxygen',
  'right because oxygen is the last stop for the electrons in the chain',
]

const PHOTOSYNTHESIS = [
  'alright today is photosynthesis which is um basically respiration running backwards',
  'plants take carbon dioxide and water and use light energy to build glucose',
  'and the leftover is oxygen which is pretty lucky for us',
  'all of it happens in the chloroplast',
  'these green stacks are the thylakoids and a whole stack is called a granum',
  'chlorophyll in the thylakoids absorbs the light and that drives the light reactions',
  'then out in the stroma the Calvin cycle uses that energy to build sugar',
  'so light reactions in the thylakoids Calvin cycle in the stroma write that down',
]

const GENETICS = [
  'okay today we are crossing two parents who are both heterozygous for eye color',
  'big B is the dominant allele for brown and little b is the recessive allele for blue',
  'we put one parent across the top and the other down the side of the Punnett square',
  'then we fill in each box with one allele from each parent',
  'so we get one BB two Bb and one bb',
  'three out of four have at least one big B so they have brown eyes',
  'only the bb kid shows the recessive phenotype blue eyes',
  'that is the classic three to one ratio uh remember the genotype is not the same as the phenotype',
]

const GENERIC = [
  'okay everyone let us get started',
  'today we are going to work through this step by step so stop me if anything is unclear',
  'look at the board here um I want you to notice how these parts connect',
  'this is the key idea for today so write it down',
  'let us try an example together',
  'quick check can someone explain that back to me in their own words',
  'great so for homework finish the practice questions at the end of the worksheet',
]

/** The sample lecture for a lecture title. */
export function scriptFor(title: string): string[] {
  if (/respirat|mitochond|\batp\b|cell/i.test(title)) return RESPIRATION
  if (/photosynth|chloroplast|plant/i.test(title)) return PHOTOSYNTHESIS
  if (/genetic|mendel|punnett|heredit|allele/i.test(title)) return GENETICS
  return GENERIC
}

const FOLLOW_UPS = [
  'this part is really important so make sure it is in your notes',
  'if you remember one thing from this diagram uh make it this part',
  'keep an eye on this part because we will come back to it',
]

/**
 * What the teacher says while a smart-annotation lasso is open: first about one key term of the circled image
 * (a different term for each new circle), then follow-ups about the same spot.
 */
export function annotationLine(terms: string[], circle: number, sentence: number): string {
  if (sentence > 0) return FOLLOW_UPS[(sentence - 1) % FOLLOW_UPS.length]
  const known = terms.filter((t) => GLOSSARY[t] || GLOSSARY[t.toLowerCase()])
  if (known.length === 0) return 'so this part I just circled um this is the piece I want you to focus on'
  const term = known[circle % known.length]
  const def = (GLOSSARY[term] ?? GLOSSARY[term.toLowerCase()]).replace(/[.;]$/, '')
  return `so this part I just circled um that is the ${term}, ${def[0].toLowerCase()}${def.slice(1)}`
}
