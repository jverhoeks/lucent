# Mermaid Diagrams

Diagrams render to SVG and follow the app theme (try switching to **Dark**).
Back to the [index](README.md).

## Flowchart — Should you deploy on Friday?

```mermaid
flowchart TD
    A([It's Friday afternoon]) --> B{Deploy to prod?}
    B -->|Sure, what could go wrong| C[Pager goes off at 2am]
    B -->|Wait until Monday| D[Enjoy the weekend]
    C --> E[Debug in pajamas ☕]
    E --> F[Vow to never deploy on Friday]
    F -.->|next Friday| B
    D --> G([Touch grass 🌱])
```

## Sequence — A cat negotiates dinner

```mermaid
sequenceDiagram
    participant C as Cat
    participant H as Human
    participant B as Food Bowl
    C->>H: 05:00 meow (loud)
    H-->>C: pretends to sleep
    C->>H: stand on chest, stare
    H->>B: fills bowl (gives up)
    B-->>C: kibble available
    C->>B: sniffs, walks away
    C->>H: meow (different kibble?)
    Note over H: betrayal
```

## Pie — How a developer's day is spent

```mermaid
pie showData
    title Where the hours go
    "Writing code" : 20
    "Debugging" : 35
    "Staring into the void" : 25
    "Coffee runs" : 15
    "Meetings about code" : 5
```

## State — The lifecycle of a TODO comment

```mermaid
stateDiagram-v2
    [*] --> Written
    Written --> Forgotten: ship it
    Forgotten --> Rediscovered: 3 years later
    Rediscovered --> Sacred: "nobody knows why"
    Sacred --> [*]: never deleted
```

## Gantt — Operation: Conquer the Couch (by a cat)

```mermaid
gantt
    title A cat's master plan
    dateFormat  HH:mm
    axisFormat  %H:%M
    section Morning
    Wake the human      :done,    a1, 05:00, 30m
    Demand breakfast    :done,    a2, after a1, 20m
    Nap on keyboard     :active,  a3, after a2, 3h
    section Afternoon
    Knock things off table :crit,  b1, 13:00, 45m
    Strategic napping      :        b2, after b1, 2h
```
