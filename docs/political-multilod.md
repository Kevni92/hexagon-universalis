# Political layer: 9 June 1815

The optional political layer uses the existing Congress of Vienna reference date
`1815-06-09`. Its chunks carry the same topology and source fingerprints as the earth pyramid;
incompatible political and terrain datasets are rejected before rendering.

Child overlap fractions are area-weighted into parents. Minority entities remain present down to
a documented one-percent threshold instead of disappearing through an unchecked winner-takes-all
rule. Sovereign borders remain visible globally; membership/subordinate borders appear from the
regional level. Every edge ID is canonical, so a border shared by two cells or chunks is emitted
once.

The layer state is independent of terrain colors and defaults to off. Enabling borders or optional
political cell fill does not mutate the earth world model. HUD data exposes the historical unit,
sovereign, regional parent/association, overlap quality, and the reference date. Source licensing
remains explicitly pending in `data/political-1815/sources.json`; the UI must not imply a more
precise historical source than the checked-in metadata provides.
