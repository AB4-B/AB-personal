/**
 * Technique help: what you physically do. Shown behind a tappable "?" next to the step that uses it.
 * Standard names stay visible in the steps so the vocabulary is learned gradually.
 */
export interface Technique {
  id: string;
  name: string;
  abbr?: string;
  /** what I physically do, step by step */
  how: string[];
  why?: string;
}

export const TECHNIQUES: Record<string, Technique> = {
  yo: { id: 'yo', name: 'Yarn over', abbr: 'yo', how: ['Bring the working yarn to the FRONT of the work, between the needles.', 'Knit the next stitch as normal: the yarn goes up and over the right needle as you knit, which leaves a loop sitting on the needle.', 'That loop is the yarn over. It is a new stitch and it leaves a small hole.'], why: 'A yarn over adds one stitch and makes an eyelet.' },
  'yo-twisted': { id: 'yo-twisted', name: 'Work a yarn over twisted', how: ['On the next row, when you reach the yarn over, work it through the BACK loop (knit it through the back loop on a right-side row, purl it through the back loop on a wrong-side row).', 'This twists the loop closed, so it does not leave a hole.'], why: 'Working it twisted closes the hole so the increase is almost invisible.' },
  k2tog: { id: 'k2tog', name: 'Knit 2 together', abbr: 'k2tog', how: ['Put the right needle into the next 2 stitches at once, going in from the front, left to right, as if to knit.', 'Wrap the yarn and knit them as if they were one stitch.', 'You have used 2 stitches to make 1, so one stitch is gone. The decrease leans to the right.'] },
  ssk: { id: 'ssk', name: 'Slip, slip, knit', abbr: 'ssk', how: ['Slip the next stitch knitwise (as if to knit it) onto the right needle.', 'Slip the following stitch knitwise too.', 'Put the left needle into the fronts of those 2 slipped stitches and knit them together through the back.', 'Two stitches become one. The decrease leans to the left.'] },
  slip: { id: 'slip', name: 'Slip a stitch', abbr: 'sl', how: ['Move the stitch from the left needle to the right needle WITHOUT working it.', 'Knitwise: put the right needle in as if to knit, then slide it across. Purlwise: put it in as if to purl.'] },
  psso: { id: 'psso', name: 'Pass the slipped stitch over', abbr: 'psso', how: ['After you slip a stitch and knit the next one, use the left needle tip to lift the slipped stitch up and over the stitch you just knitted.', 'Let it drop off the needle. That is one stitch fewer.'] },
  m1l: { id: 'm1l', name: 'Make 1 left', abbr: 'M1L', how: ['Look at the bar of yarn lying between the stitch you just worked and the next one.', 'Lift that bar onto the left needle from front to back.', 'Knit it through the back loop. You have added 1 stitch.'] },
  m1r: { id: 'm1r', name: 'Make 1 right', abbr: 'M1R', how: ['Look at the bar of yarn lying between the stitch you just worked and the next one.', 'Lift that bar onto the left needle from back to front.', 'Knit it through the front loop. You have added 1 stitch.'] },
  increase: { id: 'increase', name: 'Increase 1 stitch', how: ['Add one stitch using the method the pattern gives.', 'If the pattern does not say, a make-1 (M1L) or a yarn over worked twisted next row are both fine.'] },
  cast: { id: 'cast', name: 'Cast on', how: ['Create new stitches on the needle. If the pattern does not name a method, a long-tail cast-on is a good default.', 'When you cast on at the end of a row, use a method that adds stitches onto the right needle, such as the cable or single (backward-loop) cast-on.'] },
  provisional: { id: 'provisional', name: 'Provisional cast-on', how: ['Cast on over a spare piece of waste yarn (crochet chain or a scrap thread) instead of onto the needle directly.', 'Later you remove the waste yarn and the live stitches are free to knit from.'], why: 'It leaves the first edge open so you can knit another section from it.' },
  pickup: { id: 'pickup', name: 'Pick up and knit', abbr: 'pu&k', how: ['Hold the work with the right side facing you.', 'Put the needle tip into the edge or gap, wrap the yarn, and pull a loop through.', 'That loop is a new stitch on your needle. Repeat for each stitch you need.'] },
  hold: { id: 'hold', name: 'Put stitches on hold', how: ['Slide the stitches off the working needle onto waste yarn (thread a yarn needle and pass it through each stitch) or onto a stitch holder.', 'Do not knit them. They are kept safe, still live, for later.'] },
  bindoff: { id: 'bindoff', name: 'Bind off (cast off)', abbr: 'bo', how: ['Knit 2 stitches.', 'Lift the first stitch over the second and off the needle: 1 stitch bound off.', 'Knit 1 more stitch and repeat until 1 stitch remains. Cut the yarn and pull it through the last loop.'] },
  magicloop: { id: 'magicloop', name: 'Magic Loop', how: ['Use a circular needle with a long cable (80 cm or longer).', 'Divide the stitches in half. Slide half onto the left needle tip; pull the cable out in a loop at the halfway point so the other half rests on the cable.', 'Knit across the front half. Then shift the stitches around: pull the back needle tip through so the other half is ready to knit.', 'Knit the second half the same way. That is one round.'], why: 'It lets one long circular needle work a small circumference, so you do not need double-pointed needles.' },
  garter: { id: 'garter', name: 'Garter stitch', how: ['Knit every stitch of every row.', 'Knitting on both sides makes ridges. Every 2 rows give you 1 ridge.'] },
  stockinette: { id: 'stockinette', name: 'Stockinette stitch', how: ['Flat: knit the right-side rows and purl the wrong-side rows.', 'In the round: knit every round.'] },
  markers: { id: 'markers', name: 'Place a marker', how: ['Slide a stitch marker onto the right needle at the place the pattern says.', 'A marker thread (a loop of contrasting yarn) works too: slip it between the two stitches.', 'When you come to it on a later row, slip it from the left needle to the right needle.'] },
  rib: { id: 'rib', name: 'Rib', how: ['Knit the stitches that look like V’s and purl the stitches that look like bumps, as they face you.', 'In 1x1 rib you alternate knit 1, purl 1.'] },
  evenly: { id: 'evenly', name: 'Increase evenly spaced', how: ['Spread the new stitches across the row at roughly equal gaps.', 'Do not put any in the band stitches unless told to.'] },
  purl: { id: 'purl', name: 'Purl', abbr: 'p', how: ['Bring the yarn to the front, put the right needle into the next stitch from right to left, wrap the yarn, and pull a loop through.'] },
  knit: { id: 'knit', name: 'Knit', abbr: 'k', how: ['Put the right needle into the next stitch from front to back, wrap the yarn, and pull a loop through.'] },
  kfb: { id: 'kfb', name: 'Knit front and back', abbr: 'kfb', how: ['Put the right needle into the next stitch as if to knit, wrap the yarn and pull a loop through, but do NOT slip the old stitch off.', 'Now put the right needle into the BACK of the same stitch, wrap the yarn and pull a loop through.', 'Slip the old stitch off. One stitch has become two.'], why: 'It adds one stitch, leaving a small bar that shows on the fabric.' },
  ssp: { id: 'ssp', name: 'Slip, slip, purl', abbr: 'ssp', how: ['Slip 2 stitches knitwise, one at a time.', 'Put them back on the left needle (they are now turned).', 'Purl them together through the back loops. Two stitches become one, leaning left.'] },
  german: { id: 'german', name: 'Doubled stitch (German short row)', how: ['Turn your work so the other side faces you.', 'Slip the first stitch purlwise with the yarn at the front.', 'Pull the yarn up and over the needle to the back, so the stitch looks like two loops lying on the needle.', 'When you reach it later, knit or purl both loops together as one stitch.'], why: 'It closes the gap at a turning point so short rows leave no hole.' },
  join: { id: 'join', name: 'Join in the round', how: ['Check that the cast-on edge is not twisted around the needle (all the bumps face inward).', 'Bring the last stitch up next to the first stitch.', 'Knit the first stitch again: from now on you knit round and round and do not turn.'], why: 'Joining turns a flat strip into a tube.' },
  turn: { id: 'turn', name: 'Turn your work', how: ['At the end of the row, swap the needles between your hands so the other side faces you.', 'The yarn now sits at the start of the next row.'] },
  buttonhole: { id: 'buttonhole', name: 'Buttonhole (yarn-over type)', how: ['Make 1 yarn over, then knit 2 together.', 'The yarn over makes a hole; the k2tog keeps the stitch count the same.', 'On the next row, knit the yarn over normally (do not twist it) so the hole stays open.'] },
};

/** Technique ids found in a step's text, so the UI can show a ? beside it. */
export function techniquesIn(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  const add = (id: string, re: RegExp) => re.test(t) && out.push(id);
  add('yo-twisted', /yarn overs?[^.]*twisted|twisted[^.]*yarn over|through the back loop/);
  add('yo', /yarn over|\byo\b/);
  add('k2tog', /knit 2 together|k2tog/);
  add('ssk', /\bssk\b|slip, slip, knit/);
  add('psso', /pass the slipped stitch|\bpsso\b/);
  add('slip', /\bslip\b(?! marker)/);
  add('m1l', /\bm1l\b|make 1 left/);
  add('m1r', /\bm1r\b|make 1 right/);
  add('provisional', /provisional/);
  add('pickup', /pick up|knit up/);
  add('hold', /waste yarn|stitch holder|on hold/);
  add('bindoff', /bind off|cast off/);
  add('magicloop', /magic loop/);
  add('markers', /\bmarker/);
  add('garter', /garter/);
  add('rib', /\brib\b|ribbing/);
  add('evenly', /evenly spaced/);
  add('buttonhole', /buttonhole/);
  add('cast', /cast on/);
  add('kfb', /\bkfb\b|knit front and back|front and the back of the same/);
  add('ssp', /\bssp\b/);
  add('german', /doubled stitch|german short/);
  add('join', /join in the round/);
  return [...new Set(out)];
}
