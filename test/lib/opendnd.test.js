const expect = require('chai').expect;
const path = require('path');
const rootDir = path.join(__dirname, '..', '..');
const libDir = path.join(rootDir, 'lib');
const opendnd = require(path.join(libDir, 'opendnd'));
const { Avataria, Dynastia, Nomina, Dominia, Genetica, Personae } = opendnd;

describe('opendnd', () => {
  it('is an object with dependencies', () => {
    expect(opendnd).to.be.an('object');
    expect(Avataria).to.be.a('function');
    expect(Dynastia).to.be.a('function');
    expect(Nomina).to.be.a('function');
    expect(Dominia).to.be.a('function');
    expect(Genetica).to.be.a('function');
    expect(Personae).to.be.a('function');
  });

  it('generates an avatar', () => {
    const avatar = new Avataria().generate();

    expect(avatar).to.be.a('string');
  });

  it('generates a person', () => {
    const person = new Personae().generate();

    expect(person).to.be.an('object');
  });

  it('generates a name', () => {
    const nomina = new Nomina();
    const name = nomina.generate();

    expect(name).to.be.a('string');
  });

  it('generates a dynasty', () => {
    const dynasty = new Dynastia().generate();

    expect(dynasty).to.be.an('object');
  });

  it('generates a domain', () => {
    const domain = new Dominia().generate();

    expect(domain).to.be.an('object');
  });

  it('generates the README sample code', () => {
    // generate name
    const nomina = new Nomina();
    const name = nomina.generate();

    expect(name).to.be.a('string');

    // generate DNA
    const genetica = new Genetica();
    const DNA = genetica.generate();

    expect(DNA).to.be.an('object');

    // generate a person with our name and DNA
    // all are optional if we leave it out it will be generated for us
    const personae = new Personae();
    const person = personae.generate({
      name,
      DNA,
    });

    expect(person).to.be.an('object');

    // generate a dynasty with our person
    const dynastia = new Dynastia();
    const dynasty = dynastia.generate({
      progenitor: person,
    });

    expect(dynasty).to.be.an('object');

    // generate a town where this dynasty is from
    const dominia = new Dominia();
    const town = dominia.generate({
      size: 'town',
    });

    expect(town).to.be.an('object');
  });
});
