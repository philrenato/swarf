# ShopBot motion

How swarf moves the ShopBot (web/kiri/swarf-shopbot-card.js, class `Planner`; settings in
web/kiri/swarf-shopbot-direct.js, `SHOP`). The numbers are the shop machine's.

## Ramps
- Speed rises with distance: v = v0 + k·s, k = 15.24 / rampRate (mm/s per mm). With rampRate
  5.08 that is 3 mm/s per mm: 100 mm/s about 30 mm into a move.
- **Start speed** (`startSpeed`, 2.54 mm/s): a move from rest starts there, and a move to rest
  ends there. A jump straight to the ramp speed knocks the gantry, which then rings; from 2.54,
  X ringing after a stop is about half. Costs about 0.9 s on a 250 mm jog.
  Homing and the Z plate keep the plain ramps (start at the ramp speed): their contact is placed
  by counting the card's ticks, and with the slow start homing landed 5.7 mm off its corner.
- **Ramp speed** (`rampSpeed`, 10.16 mm/s): the speed through a right-angle corner or sharper.
  Gentler bends keep more speed; under 3° keeps full speed.
- **Stop** (pause, stop, e-stop, a seek's contact): ramps down at kStop = 50.8 / rampRate
  (10 mm/s per mm) and ends at the ramp speed, at once: about 6–10 mm from 100 mm/s, and a slow
  seek (the Z plate) stops on the next tick after contact.
- A move whose feed is below the start speed runs at its own feed, unramped.

## Rough speeds
Steady travel on the shop machine (no load):
- **X** (the gantry) roars around 20 mm/s; rough from about 16 to 30 mm/s. Quiet at 12 mm/s and
  below and at 60 mm/s and above. Frame shake rises with speed above 50 mm/s.
- **Y** (the carriage) is milder at every speed; quietest around 35 mm/s.
- Ramps pass through the rough band in a fraction of a second. Steady moves in it are the loud
  ones: homing's slow seek (25.4 mm/s) and cut feeds of about 1000–1800 mm/min. Jog speeds skip the
  band: 250, 500, 700, 2500 (the default) and 5000 mm/min.
- **Slanted moves** share the speed between the axes: a go-to at 2500 mm/min on a 45° slant puts X
  at about 30 mm/s. Jogs, go-tos, rapids and the way into a job (not cuts, not air cuts, not moves
  with Z in them, not seeks) take a speed that keeps X's share out of 16–30 mm/s: the nearer edge
  of the band, faster only within the rapid speed (100 mm/s) (`smooth`, ROUGH in
  swarf-shopbot-direct.js; tools/shopbot/test-rough-band.mjs).

## Measuring
The tuning page (branch `shopbot-tune`, web/kiri/tune/, never deployed) runs fixed test moves
inside a ±12 in box with the spindle locked off, logs every move, and
tools/tune/analyse.mjs lines the log up with a phone accelerometer recording (phyphox CSV) to
rank settings by ringing after a stop. Its speed sweep runs steady passes from 8 to 100 mm/s.
A phone samples at about 100 Hz: it sees frame shake, not the motor buzz; record sound for that.

## Lead-in
The way into a job (up to safe Z, over to the start, slowly down) goes over at the jog row's
speed, never under 2500 mm/min and never over the rapid (`leadXY`, swarf-shopbot-direct.js). At the
full rapid (100 mm/s) the gantry shook through the lead-in (Phil, 11-24). The program's own rapids
keep the rapid speed.
