// @ts-check

import { E } from '@endo/far';
import { AmountMath, installContract, startContract } from './platform-goals/start-contract.js';

import { fixHub } from './fixHub.js';

const { Fail, quote: q } = assert;

const PERCENT = 100n;

/** 
* @param {bigint} numerator
 * @param {Brand} numeratorBrand
 * @param {bigint} [denominator] The default denominator is 100
 * @param {Brand} [denominatorBrand] The default is to reuse the numeratorBrand
 * @returns {Ratio}
 */
export const makeRatio = (
  numerator,
  numeratorBrand,
  denominator = PERCENT,
  denominatorBrand = numeratorBrand,
) => {
  denominator > 0n ||
    Fail`No infinite ratios! Denominator was 0 ${q(denominatorBrand)}`;

  // @ts-expect-error cast to return type because make() ensures
  return harden({
    numerator: AmountMath.make(numeratorBrand, numerator),
    denominator: AmountMath.make(denominatorBrand, denominator),
  });
};



const contractName = 'onrampPriceRegistry';

/**
 * @param {BootstrapPowers} powers 
 * @param {*} config
 */
export const startPriceRegistry = async (powers, config) => {
  const {
    bundleID = Fail`No bundleID provided for ${contractName} contract`,
  } = config?.options?.[contractName] ?? {};

  console.log('Starting contract', contractName);

  const installation = await installContract(powers, {
    name: contractName,
    bundleID,
  });

  const { consume } = powers;
  const { 
    namesByAddressAdmin,
    chainTimerService,
    agoricNames,
    chainStorage,
    board,
  } = consume;


  const [
    namesByAddressAdminResolved,
    timerResolved,
  ] = await Promise.all([
    namesByAddressAdmin,
    chainTimerService,
  ]);

  const namesByAddress = await fixHub(namesByAddressAdmin);


  const terms = harden({ namesByAddress });
  
  // const istIssuer = await E(agoricNames).lookup('issuer', 'IST');
  // const issuerKeywordRecord = harden({ Stable: istIssuer });
  // @ts-expect-error
  const storageNode = await E(chainStorage).makeChildNode(contractName);

  const privateArgs = {
    timer: timerResolved,
    namesByAddressAdmin: namesByAddressAdminResolved,
    marshaller: await E(board).getPublishingMarshaller(),
    storageNode,
  };



  const issuerKeywordRecord = harden({});
  const installedInstance = await startContract(powers, {
    name: contractName,
    startArgs: {
      installation,
      issuerKeywordRecord,
      terms,
      privateArgs,
    },
    issuerNames: ['OnrampQuote'],
  });

  console.log(contractName, 'started');
  if (!installedInstance) throw Error('Not instantiated');

  
  const {publicFacet, instance  } = installedInstance;

  // test after instance 
  const istIssuer = await E(agoricNames).lookup('issuer', 'IST');

  const bldIssuer =  await E(agoricNames).lookup('issuer', 'BLD');
  console.log('instance is ', instance );
  console.log('public facet is ', publicFacet);
  const bldBrand =  await E(bldIssuer).getBrand();

  console.log('kesh brand is ', bldBrand);

  const istBrand =  await E(istIssuer).getBrand();
   console.log('ist brand', istBrand);
  // @ts-ignore
  const priceAuthority  = await E(publicFacet).registerPricePair(istBrand, bldBrand);

  console.log('priceAuthority is ', priceAuthority);
  const [istBrandR, bldBrandR] = await Promise.all([
      istBrand, bldBrand
  ])
  const initialPrice =  makeRatio(1000000n, istBrandR, 99000000n, bldBrandR);

  console.log('registered authority ');
  // await new Promise(resolve => setTimeout(resolve, 300));

  // @ts-ignore
  await E(publicFacet).updatePrice(initialPrice);

  console.log('price updated ');

};
/** @type { import("@agoric/vats/src/core/lib-boot").BootstrapManifestPermit } */
export const permit = harden({
  consume: {
    zoe: true,
    agoricNames: true,
    agoricNamesAdmin: true,
    startUpgradable: true,
    brandAuxPublisher: true,
    board: true,
    chainTimerService: true,
    storageNode: true,
    chainStorage: true,
    namesByAddress: true,
    namesByAddressAdmin: true,
  },
  installation: {
    consume: { [contractName]: true },
    produce: { [contractName]: true },
  },
  instance: { produce: { [contractName]: true } },
  issuer: { 
    produce: { OnrampQuote: true },
  },
  brand: { 
    produce: { OnrampQuote: true },
  },
});

export const main = startPriceRegistry;