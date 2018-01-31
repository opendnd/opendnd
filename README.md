# opendnd
This is the main collection of OpenDnD Tools with generators for persons, dynasties, cities, towns, and more

[![NPM](https://nodei.co/npm/opendnd.png?downloads=true&stars=true)](https://nodei.co/npm/opendnd/)

[![Build Status](https://travis-ci.org/opendnd/opendnd.svg?branch=master)](https://travis-ci.org/opendnd/opendnd)

## Installation
You will need [node](https://nodejs.org/en/) and [npm](https://www.npmjs.com/) installed. Then run the command:

`npm install -g opendnd`

## Generate from CLI

```shell
dnd name    # generate a name for a character or city
dnd dna     # generate DNA for a person with unique traits and physical characteristics
dnd person  # generate a person either a playable character or non
dnd domain  # generate a kingdom, city, town, etc. for the characters to explore
dnd dynasty # generate a dynasty to give the kingdom a rich history
``` 

## Module Usage

Require opendnd into your file and use either of the opendnd classes.

```javascript
const opendnd = require('opendnd');
const { Nomina, Genetica, Personae, Dominia, Dynastia } = opendnd;

// generate name
const name = Nomina.generate();
const themes = Nomina.getThemes();

// generate DNA
const genetica = new Genetica();
const DNA = genetica.generate();

// generate a person with our name and DNA
// all are optional if we leave it out it will be generated for us
const personae = new Personae();
const person = personae.generate({
  name,
  DNA,
});

// generate a dynasty with our person
const dynastia = new Dynastia();
const dynasty = dynastia.generate({
  progenitor: person,
});

// generate a town where this dynasty is from
const dominia = new Dominia();
const town = dominia.generate({
  size: 'town',
});
```

## Features
Here are the features of Dynastia:

### Person Generating
For more on person generating please see the Personae [README](https://github.com/opendnd/personae/blob/master/README.md).

### Name Generating
For more on name generating please see the Nomina [README](https://github.com/opendnd/nomina/blob/master/README.md).

### DNA Generating
For more on DNA generating please see the Genetica [README](https://github.com/opendnd/genetica/blob/master/README.md).

### Domain (kingdoms, cities, towns, etc.) Generating
For more on domain generating please see the Dominia [README](https://github.com/opendnd/dominia/blob/master/README.md).

### Dynasty Generating
For more on person dynasty please see the Dynastia [README](https://github.com/opendnd/dynastia/blob/master/README.md).

## Developing

To develop with OpenDnD,

```shell
git clone https://github.com/opendnd/opendnd.git
cd opendnd/
npm install
```

## Contributing

If you'd like to contribute, please fork the repository and use a feature
branch. Pull requests are welcome!

OpenDnD use the [Airbnb](https://github.com/airbnb/javascript) javascript style.

## Licensing

[MIT](https://github.com/opendnd/opendnd/blob/master/LICENSE)
