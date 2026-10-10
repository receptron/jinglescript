# Piano classics

Complete public-domain piano pieces written as JingleScript scores for the `grandpiano` instrument, each one
transcribed note by note from a public-domain edition and checked bar by bar against the printed score.
They are long (3–6 minutes, 1,100–4,100 notes) and place notes in seconds (`{"seconds": n}`) with per-bar
tempo, dynamics and voicing, so they show what a full-length score looks like.

Render one with the CLI:

```sh
node src/cli.ts render examples/piano/clair-de-lune.json -o out/clair-de-lune.mp3
```

They are not in the top-level `examples/` folder because the test suite renders every file there; rendering
these takes minutes. `tests/examples-piano.test.ts` only parses them.

## Pieces

| File | Piece | Composer | Length | Licence |
|---|---|---|---|---|
| `arabesque-1.json` | Première Arabesque, L.66 No.1 | Claude Debussy | 4:24 | CC BY 4.0 |
| `clair-de-lune.json` | Clair de lune (Suite bergamasque, L.75 No.3) | Claude Debussy | 5:51 | CC BY 4.0 |
| `fantaisie-impromptu.json` | Fantaisie-Impromptu in C-sharp minor, Op.66 | Frédéric Chopin | 4:49 | CC BY 4.0 |
| `la-campanella.json` | La Campanella (Grandes études de Paganini, S.141 No.3) | Franz Liszt | 4:59 | CC BY 4.0 |
| `moonlight-sonata-1.json` | Piano Sonata No.14 "Moonlight", Op.27 No.2 — I. Adagio sostenuto | Ludwig van Beethoven | 5:31 | CC BY-SA 4.0 |
| `nocturne-op9-2.json` | Nocturne in E-flat major, Op.9 No.2 | Frédéric Chopin | 4:43 | CC BY-SA 4.0 |
| `pathetique-2.json` | Piano Sonata No.8 "Pathétique", Op.13 — II. Adagio cantabile | Ludwig van Beethoven | 5:04 | CC BY 4.0 |
| `rachmaninoff-prelude-op3-2.json` | Prelude in C-sharp minor, Op.3 No.2 ("The Bells of Moscow") | Sergei Rachmaninoff | 3:29 | CC BY-SA 4.0 |
| `schubert-impromptu-op90-3.json` | Impromptu in G-flat major, D.899 (Op.90) No.3 | Franz Schubert | 6:17 | CC BY 4.0 |

## Licence

These score files are **not** covered by the repository's MIT licence. Each carries its own `author` and
`copyright` fields:

- **CC BY 4.0** — © 2026 Satoshi Nakajima. Transcribed from public-domain sources. Share and adapt, including
  commercially, with attribution: <https://creativecommons.org/licenses/by/4.0/>.
- **CC BY-SA 4.0** — © 2026 Satoshi Nakajima. Adapted from Mutopia Project editions released under CC BY-SA;
  adaptations must keep the same licence and the credits below: <https://creativecommons.org/licenses/by-sa/4.0/>.

## Credits and sources

- **Première Arabesque, L.66 No.1** — Music: Claude Debussy (public domain). Notes converted from the Mutopia Project edition by Keith OHara (public domain dedication), typeset from Durand & Fils 1904; checked against the Durand 1904 print (IMSLP #255354).
  Source: Durand & Fils, Paris, 1904, plate D.&F. 4395, public domain — IMSLP #255354
- **Clair de lune (Suite bergamasque, L.75 No.3)** — Music: Claude Debussy (public domain). Notes converted from the Mutopia Project edition by Keith OHara (public domain dedication), checked against the E. Fromont first-edition plates (IMSLP).
  Source: E. Fromont first-edition plates (E.1404 F), public domain — IMSLP #27826; notes converted from the Mutopia Project edition (public domain, typeset from Fromont 1905 by Keith OHara): https://www.mutopiaproject.org/
- **Fantaisie-Impromptu in C-sharp minor, Op.66** — Music: Frédéric Chopin (public domain). Notes converted from the Mutopia Project edition by Guy D. Lederfein (public domain dedication), typeset from the Hermann Scholtz edition; checked against the C.F. Peters 1879 Scholtz print (IMSLP #34243).
  Source: C.F. Peters, Leipzig, n.d. [1879], ed. Hermann Scholtz, plate 6216 (Sämtliche Pianoforte-Werke, Band II, pp.331–36), public domain — IMSLP #34243
- **La Campanella (Grandes études de Paganini, S.141 No.3)** — Music: Franz Liszt (public domain). Transcribed from the public-domain Augener edition scan (IMSLP). The (n)ASAP dataset (CC BY-NC-SA 4.0) was used only to flag possible misreadings; no notes were copied from it.
  Source: Augener edition (ed. E. Pauer), public domain — IMSLP: https://imslp.org/wiki/Grandes_%C3%A9tudes_de_Paganini,_S.141_(Liszt,_Franz)
- **Piano Sonata No.14 "Moonlight", Op.27 No.2 — I. Adagio sostenuto** — Music: Ludwig van Beethoven (public domain). Derived from the Mutopia Project edition typeset by Stewart Holmes (2007), source Berners 1908 ed. A. Winterberger, CC BY-SA 2.5 — https://www.mutopiaproject.org/ . Checked against the Cappi 1802 first edition (IMSLP #15808). Derived score and audio are CC BY-SA 4.0 (see Licence above).
  Source: Gio. Cappi e Comp., Vienna, n.d. [1802], plate 879 (first edition), public domain — IMSLP #15808
- **Nocturne in E-flat major, Op.9 No.2** — Music: Frédéric Chopin (public domain). Derived from the Mutopia Project edition typeset by Renato Biolcati Rinaldi (2014), source G. Schirmer 1881, CC BY-SA 3.0 — https://www.mutopiaproject.org/ . Checked against the Kullak Instructive Edition (Schlesinger/Schirmer 1881, IMSLP #80717). Derived score and audio are CC BY-SA 4.0 (see Licence above).
  Source: Klavierwerke, Instructive Ausgabe Vol.V (ed. Th. Kullak), Schlesinger, Berlin 1881, co-issued by G. Schirmer, New York, public domain — IMSLP #80717
- **Piano Sonata No.8 "Pathétique", Op.13 — II. Adagio cantabile** — Music: Ludwig van Beethoven (public domain). Notes converted from the Mutopia Project edition by Chris Sawer (public domain dedication; sources Berners 1908 ed. Winterberger and Peters 1910), checked against the C.F. Peters ca.1910 print (IMSLP #30364).
  Source: C.F. Peters, Leipzig, n.d. (ca.1910), Sonaten für Pianoforte solo Bd.1, plate 9452, public domain — IMSLP #30364
- **Prelude in C-sharp minor, Op.3 No.2 ("The Bells of Moscow")** — Music: Sergei Rachmaninoff (public domain). Derived from the Mutopia Project edition typeset by Petro Kostandy (Mutopia-2015/07/09-2033), CC BY-SA 4.0 — https://www.mutopiaproject.org/ . Checked against the Bosworth 1896 / UE ca.1910 print (IMSLP #79003). Derived score and audio are CC BY-SA 4.0 (see Licence above).
  Source: Bosworth & Co. 1896, reprinted by Universal Edition ca.1910 (plate B. & Co. 2871), public domain — IMSLP #79003
- **Impromptu in G-flat major, D.899 (Op.90) No.3** — Music: Franz Schubert (public domain). Notes converted from the Mutopia Project edition by Ph. Raynaud (public domain dedication), typeset from Breitkopf & Härtel 1888; checked against the B&H 1888 Gesamtausgabe print (IMSLP #39751).
  Source: Franz Schubert's Werke, Serie XI No.2, Breitkopf & Härtel, Leipzig 1888, plate F.S. 109, public domain — IMSLP #39751
