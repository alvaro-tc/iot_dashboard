#let serif = ("Libertinus Serif", "Georgia", "Times New Roman")
#let sans  = ("Segoe UI", "Calibri", "Arial")
#let gris  = rgb("#ededed")
#let azul  = rgb("#1b4b8a")

#set page(paper: "a4", margin: (x: 2.5cm, y: 2.5cm), numbering: "1")
#set text(font: serif, size: 12pt, lang: "es")
#set par(justify: true, leading: 0.72em, spacing: 0.9em)
#set heading(numbering: none)
#set list(marker: [#text(fill: azul)[•]], indent: 0.4em, spacing: 0.7em)

#show heading.where(level: 1): it => block(above: 1.6em, below: 0.9em)[
  #set text(font: sans, size: 13.5pt, weight: "bold", fill: azul)
  #it.body
  #v(-0.45em)
  #line(length: 100%, stroke: 0.6pt + azul.lighten(45%))
]

// ---------- CARÁTULA ----------
#page(numbering: none, margin: (x: 2.2cm, top: 1.8cm, bottom: 1.8cm))[
  #set text(font: sans, size: 12pt)
  #align(center)[#image("logo.png", width: 72%)]
  #v(0.6cm)

  #align(center)[
    #text(size: 24pt, weight: "bold")[INFORME]
    #linebreak()
    #text(size: 24pt, weight: "bold")[PRIMERA EVALUACIÓN]
  ]
  #v(0.9cm)

  #align(center)[
    #text(size: 16pt, weight: "bold")[ASIGNATURA]
    #linebreak()
    #text(size: 16pt, weight: "bold")[INTERNET DE LAS COSAS]
  ]
  #v(0.7cm)

  #let etq(t) = text(size: 12pt, weight: "bold")[#t]
  #let val(t) = text(size: 12pt)[#t]
  #let raya = box(width: 5cm, repeat[\_])

  #table(
    columns: (5.2cm, 1fr),
    stroke: none,
    inset: (x: 10pt, y: 9pt),
    align: (left + horizon, left + horizon),
    fill: (col, row) => if col == 0 { gris } else { none },

    etq("GRUPO N.º"), val(raya),
    etq("INTEGRANTES"), val[
      #stack(spacing: 0.9em,
        [1.~#box(width: 7.2cm, repeat[\_])],
        [2.~#box(width: 7.2cm, repeat[\_])],
        [3.~#box(width: 7.2cm, repeat[\_])],
      )
    ],
    etq("DOCENTE"), val("Ing. Pamela Valenzuela"),
    etq("CARRERA"), val("Ingeniería de Sistemas"),
    etq("FECHA DE ENTREGA"), val(raya),
    etq("GESTIÓN"), val("II/2026"),
  )

  #v(1.6cm)
  #align(center)[
    #text(size: 15pt, weight: "bold")[LA PAZ – BOLIVIA]
    #linebreak()
    #text(size: 15pt, weight: "bold")[2026]
  ]
  #v(0.5cm)
]

// ---------- ÍNDICE ----------
#page(numbering: none)[
  #align(center)[#text(size: 16pt, weight: "bold")[ÍNDICE]]
  #v(0.8cm)
  #outline(title: none, indent: 1.2em, depth: 2)
]

#counter(page).update(1)

// ---------- CONTENIDO ----------
#align(center)[#text(size: 14pt, weight: "bold")[FORMATO DEL INFORME – PRIMERA EVALUACIÓN]]
#v(0.6cm)

