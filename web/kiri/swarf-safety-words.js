/*
 * swarf safety words — the sentences about people and the machine that the shop poster, the
 * quick start and control all say (third review 10-28 #7: one reviewed copy, so improving one
 * never leaves a stale one elsewhere). The poster ("Run ShopBot with Swarf") copies these word
 * for word; change them here, then tell the poster.
 *   keyPause   what a key does while a job runs: it pauses, it is not an emergency stop
 *   finished   what to do at Finished: wait for the bit to stop turning before reaching in
 *   coasting   while the bit is still slowing after a cut
 *   emergency  the floor e-stop
 * Phil 10-28: the poster and the quick start do not tell students to switch the router off at
 * its own switch ("they might forget to turn it on"); swarf switches it.
 */
(function (root) {
  'use strict';
  root.SwarfSafetyWords = Object.freeze({
    keyPause: 'Any key pauses while swarf is in front. Not an emergency stop.',
    finished: 'At Finished, wait until the bit has stopped turning. Then vacuum, raise the bit and unscrew the board. Cut the tabs away from the machine.',
    coasting: 'Finished. The router is off, but the bit is still slowing down: keep your hands clear until it has stopped turning.',
    emergency: 'In an emergency, step on the red e-stop on the floor and keep clear until everything has stopped.'
  });
})(window);
