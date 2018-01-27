const expect = require('chai').expect;
const path = require('path');
const rootDir = path.join(__dirname, '..', '..');
const libDir = path.join(rootDir, 'lib');
const opendnd = require(path.join(libDir, 'opendnd'));

describe('opendnd', () => {
  it('is an object with dependencies', () => {
    expect(opendnd).to.be.an('object');
    expect(opendnd.Dynastia).to.be.an('function');
    expect(opendnd.Nomina).to.be.an('function');
    expect(opendnd.Dominia).to.be.an('function');
    expect(opendnd.Genetica).to.be.an('function');
    expect(opendnd.Personae).to.be.an('function');
  });

  it('generates a person', () => {
    const person = new opendnd.Personae().generate();

    expect(person).to.be.an('object');
  });

  it('generates a name', () => {
    const name = opendnd.Nomina.generate();

    expect(name).to.be.a('string');
  });

  it('generates a dynasty', () => {
    const dynasty = new opendnd.Dynastia().generate();

    expect(dynasty).to.be.an('object');
  });

  it('generates a domain', () => {
    const domain = new opendnd.Dominia().generate();

    expect(domain).to.be.an('object');
  });
});
