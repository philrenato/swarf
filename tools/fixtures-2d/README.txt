Fixtures for the 2D gates.
- two-shapes.{ai,pdf,dxf,svg}: made by Unreason's 2D writers (a 100 mm circle, a 60 x 40 rectangle, an open line).
- Inter-Regular.ttf: Inter by Rasmus Andersson (https://github.com/rsms/inter), SIL Open Font
  License 1.1 (the license and copyright are in the font's own name table). Used by
  tools/probe_text.mjs as "a font picked from a file".
- uses-hidden-text.svg: two-shapes.svg with the circle drawn through a <use> of a <defs> path, a rect
  hidden by a <style> class rule and a text: the same two parts, text and the hidden shape said.
- two-shapes-3pages.pdf: two-shapes.pdf whose page tree lists its page three times (/Count 3): the
  import reads the first page and says the file has 3 pages.
