# ShopBot motion

How swarf moves the ShopBot (web/kiri/swarf-shopbot-card.js, class `Planner`; settings in
web/kiri/swarf-shopbot-direct.js, `SHOP`). The numbers are the shop machine's.

## Ramps
- Speed rises with distance: v = v0 + k·s, k = 15.24 / rampRate (mm/s per mm). With rampRate
  5.08 that is 3 mm/s per mm: 100 mm/s about 30 mm into a move.
- **Start speed** (`startSpeed`, 2.54 mm/s): a move from rest starts there, and a move to rest
  ends there. A jump straight to the ramp speed knocks the gantry, which then rings; from 2.54,
  X ringing after a stop is about half. Costs about 0.9 s on a 250 mm jog.
- **Ramp speed** (`rampSpeed`, 10.16 mm/s): the speed through a right-angle corner or sharper.
  Gentler bends keep more speed; under 3° keeps full speed.
- **Stop** (pause, stop, e-stop): ramps down at kStop = 50.8 / rampRate (10 mm/s per mm), to the
  start speed: about 6–10 mm from 100 mm/s.
- A move whose feed is below the start speed runs at its own feed, unramped.

## Rough speeds
Steady travel on the shop machine (no load):
- **X** (the gantry) roars around 20 mm/s; rough from about 16 to 30 mm/s. Quiet at 12 mm/s and
  below and at 60 mm/s and above. Frame shake rises with speed above 50 mm/s.
- **Y** (the carriage) is milder at every speed; quietest around 35 mm/s.
- Ramps pass through the rough band in a fraction of a second. Steady moves in it are the loud
  ones: continuous jog at 1000 mm/min (16.7 mm/s), homing's slow seek (25.4 mm/s), and cut
  feeds of about 1000–1800 mm/min.

## Measuring
The tuning page (branch `shopbot-tune`, web/kiri/tune/, never deployed) runs fixed test moves
inside a ±12 in box with the spindle locked off, logs every move, and
tools/tune/analyse.mjs lines the log up with a phone accelerometer recording (phyphox CSV) to
rank settings by ringing after a stop. Its speed sweep runs steady passes from 8 to 100 mm/s.
A phone samples at about 100 Hz: it sees frame shake, not the motor buzz; record sound for that.
