
// @ts-check
import { AmountMath, AssetKind, makeIssuerKit } from "@agoric/ertp";
import { makeNotifierKit } from "@agoric/notifier";
import { makeRatio } from "@agoric/zoe/src/contractSupport/ratio.js";

import { prepareRecorderKitMakers } from "@agoric/zoe/src/contractSupport/recorder.js";
import { makeManualPriceAuthority } from "@agoric/zoe/tools/manualPriceAuthority.js";
import { E, Far } from "@endo/far";
import { M } from "@endo/patterns";
import { makeTracer } from "./debug.js";
const trace = makeTracer('price-registry', 'verbose');

// TODO TOASK: Is this sane?
const DEFAULT_DECIMAL_PLACES = 6;

/** @typedef {ReturnType<typeof makeNotifierKit>['updater']} Updater */
/** @typedef {ReturnType<typeof makeManualPriceAuthority>} ManualPriceAuthority */

/**
 * @typedef {Object} PriceAuthorityTerms
 * @property {import('@agoric/vats').NameHub} namesByAddress
 */

/**
 * @typedef {Object} PaPrivaterArgs
 * @property {import('@agoric/time/src/types').TimerService} timer
 * @property {ERef<StorageNode>} storageNode
 * @property {ERef<Marshaller>} marshaller
 */


/**
 * @typedef {Object} AmountWithDisplay
 * @property {Amount} amount - The actual amount
 * @property {Object} displayInfo
 * @property {number} displayInfo.decimalPlaces
 */

/**
 * @typedef {Object} PriceQuoteRecord
 * @property {AmountWithDisplay} amountIn - The input amount with display info
 * @property {AmountWithDisplay} amountOut - The output amount with display info
 * @property {import("@agoric/time/src/types.js").TimestampRecord} lastUpdated - When the quote was recorded
 */


export const meta = harden({
    customTermsShape: {
        namesByAddress: M.remotable('namesByAddress'),
    },
    privateArgsShape: M.splitRecord({
        timer: M.remotable('TimerService'),
        storageNode: M.remotable('StorageNode'),
        marshaller: M.remotable('Marshaller'),
    }),
});

const ORACLE_ADDRESS = 'agoric1ydzxwh6f893jvpaslmaz6l8j2ulup9a7x8qvvq';

/**
 * 
 * @param {ZCF<PriceAuthorityTerms>} zcf 
 * @param {PaPrivaterArgs} privateArgs 
 * @param {import('@agoric/vat-data').Baggage} baggage
 * @returns 
 */
const start = async (zcf, privateArgs, baggage) => {
    trace('we now about to starting the new priceAuthority ');
    const { timer, storageNode, marshaller } = privateArgs;
    const priceFeedNode = await E(storageNode).makeChildNode('priceFeed');

    /** 
    * @typedef {Object} PairData
     * @property {ManualPriceAuthority} priceAuthority
     * @property {import('@agoric/zoe/src/contractSupport/recorder.js').RecorderKit<PriceQuoteRecord>} recorder
     */
    /** @type {Map<Brand, Map<Brand, PairData>>} */
    const assetToPriceMap = new Map();
    // Create quote issuer for price quotes
    const quoteIssuerKit = makeIssuerKit(
        'OnrampQuote',
        AssetKind.SET
    );
    await zcf.saveIssuer(quoteIssuerKit.issuer, 'OnrampQuote');
    // Create stores for both brandIn and brandOut
    const { namesByAddress } = zcf.getTerms();

    /**
   * Creates a consistent pair identifier string, always in alphabetical order
   * @param {ERef<Brand>} brandA 
   * @param {ERef<Brand>} brandB
   * @returns {Promise<string>}
   */
    const makePairId = async (brandA, brandB) => {
        const [nameIn, nameOut] = await Promise.all([
            E(brandA).getAllegedName(),
            E(brandB).getAllegedName(),
        ]);

        return nameIn.localeCompare(nameOut) <= 0
            ? `${nameIn}_${nameOut}`
            : `${nameOut}_${nameIn}`;
    };

    const { makeRecorderKit } = prepareRecorderKitMakers(baggage, marshaller);
    /**
    * Creates a new recorder for a specific price pair
    * @param {ERef<Brand>} brandIn 
    * @param {ERef<Brand>} brandOut 
    */
    const makePairRecorder = async (brandIn, brandOut) => {
        const pairId = await makePairId(brandIn, brandOut);
        const pairNode = await E(priceFeedNode).makeChildNode(pairId);
        return makeRecorderKit(
            pairNode,
            /** @type {import('@agoric/zoe/src/contractSupport/recorder.js').TypedMatcher<PriceQuoteRecord>} */
            (M.any())
        );
    };

    /**
     * Get recorder for a pair if it exists
     * @param {Brand} brandIn
     * @param {Brand} brandOut
     * @returns {import('@agoric/zoe/src/contractSupport/recorder.js').RecorderKit<PriceQuoteRecord> | undefined}
    */
    const recorderFor = (brandIn, brandOut) => {
        const priceMap = assetToPriceMap.get(brandIn);
        const directRecorder = priceMap?.get(brandOut)?.recorder;
        if (directRecorder) return directRecorder;
        // Check reverse direction
        const reverseMap = assetToPriceMap.get(brandOut);
        return reverseMap?.get(brandIn)?.recorder;
    };
    /**
     * Get price authority for a pair if it exists (checks both directions)
     * @param {ERef<Brand>} brandInP 
     * @param {ERef<Brand>} brandOutP 
     * @returns {Promise<ManualPriceAuthority | undefined>}
     */
    const findPa = async (brandInP, brandOutP) => {
        const [brandIn, brandOut] = await Promise.all([
            brandInP,
            brandOutP,
        ]);
        const priceMap = assetToPriceMap.get(brandIn);
        const directPa = priceMap?.get(brandOut)?.priceAuthority;
        if (directPa) return directPa;
        // Check reverse direction
        const reverseMap = assetToPriceMap.get(brandOut);
        return reverseMap?.get(brandIn)?.priceAuthority;
    };

    /**
     * Check if a price pair exists in either direction
     * @param {Brand} brandA 
     * @param {Brand} brandB 
     * @returns {Promise<boolean>}
     */
    const pricePairExists = async (brandA, brandB) => {
        // Check both directions
        const pa = await findPa(brandA, brandB);
        return Boolean(pa);
    };
    /** 
    * Get the registered price authority for a given input and output pair.
    * @param {ERef<Brand>} brandInP
    * @param {ERef<Brand<'nat'>>} brandOutP
    * @returns {Promise<ManualPriceAuthority>}
    */
    const paFor = async (brandInP, brandOutP) => {
        const [nameIn, nameOut] = await Promise.all([
            E(brandInP).getAllegedName(),
            E(brandOutP).getAllegedName(),
        ]);
        const pa = await findPa(brandInP, brandOutP);
        assert(pa, `No price authority for ${nameIn} -> ${nameOut}`);
        trace('pa found is ', pa);
        return pa;
    };

    const makeQuoteWhen = (relation) => {
        return async (amountIn, amountOutLimit) => {
            const pa = paFor(amountIn.brand, amountOutLimit.brand);
            return E(pa)[`quoteWhen${relation}`](amountIn, amountOutLimit);
        };
    };

    const makeMutableQuoteWhen = (relation) =>
        async (amountIn, amountOutLimit) => {
            const pa = paFor(amountIn.brand, amountOutLimit.brand);
            return E(pa)[`mutableQuoteWhen${relation}`](amountIn, amountOutLimit);
        };
    /**
     * 
     * @param {ERef<Brand<'nat'>>} brandInP
     * @param {ERef<Brand<'nat'>>} brandOutP 
     * 
     */
    const registerPricePair = async (brandInP, brandOutP) => {
        // const pairId = makePairId(brandIn, brandOut);
        const pairId = await makePairId(brandInP, brandOutP);

        const [brandIn, brandOut] = await Promise.all([
            brandInP,
            brandOutP,
        ]);

        // Get display info for both brands to handle decimal places
    const [brandInInfo, brandOutInfo] = await Promise.all([
        E(brandIn).getDisplayInfo(),
        E(brandOut).getDisplayInfo(),
    ]);

        trace('Brand In decimals:', brandInInfo.decimalPlaces);
        trace('Brand Out decimals:', brandOutInfo.decimalPlaces);

        

        trace(' we registering brand in is deez  ', brandIn);
        trace('we registering brand out is ', brandOut);
        const exists = await pricePairExists(brandIn, brandOut);
        assert(!exists,
            `Price pair already exists for ${pairId}`);
        trace(`Registering price pair: ${pairId}`);

        let priceMap = assetToPriceMap.get(brandIn);
        if (!priceMap) {
            priceMap = new Map();
            assetToPriceMap.set(brandIn, priceMap);
        }

        // Use the brand's decimal places or fall back to default
        const inDecimals = brandInInfo.decimalPlaces || DEFAULT_DECIMAL_PLACES;
        const outDecimals = brandOutInfo.decimalPlaces || DEFAULT_DECIMAL_PLACES;

        // Initial price ratio should account for decimal places
        // For example, if 1 IST (6 decimals) = 134 KESH (2 decimals)
        const pricePairAuthority = makeManualPriceAuthority({
            actualBrandIn: brandIn,
            actualBrandOut: brandOut,
            timer,
             //we  start with 1:1 ratio but account for decimal places
             // TODO  TOASK does this make sense??
             initialPrice: makeRatio(
                1n * 10n ** BigInt(outDecimals),
                brandOut,
                1n * 10n ** BigInt(inDecimals), 
                brandIn
            ),
            quoteIssuerKit,
        });
        const recorderKit = await makePairRecorder(brandInP, brandOutP);
        assert(recorderKit, 'Recorder kit must be created');
        priceMap.set(brandOut, {
            priceAuthority: pricePairAuthority,
            recorder: recorderKit,
        });
        assetToPriceMap.set(brandIn, priceMap);


        trace(`Price pair registered: ${await makePairId(brandInP, brandOutP)}`);
        trace(`Price map size: ${assetToPriceMap.size}`);    
    };

    /** @type {ManualPriceAuthority} */
    const priceAuthority = Far('CustomPriceAuthority', {
        /**
         * 
         * @param {Brand<'nat'>} brandIn 
         * @param {Brand<'nat'>} brandOut 
         * @returns 
         */
        getQuoteIssuer(brandIn, brandOut) {
            const pa = paFor(brandIn, brandOut);
            return E(pa).getQuoteIssuer(brandIn, brandOut);
        },
        getTimerService(brandIn, brandOut) {
            return Promise.resolve(timer);
        },
        async quoteGiven(amountIn, brandOut) {
            trace('quote given: Amount in is ', amountIn);
            trace('quoteGiven: brand out is ', brandOut);
            const pa = await paFor(amountIn.brand, brandOut);
            return E(pa).quoteGiven(amountIn, brandOut);
        },
        async quoteWanted(brandIn, amountOut) {
            const pa = await paFor(brandIn, amountOut.brand);
            return E(pa).quoteWanted(brandIn, amountOut);
        },
        async makeQuoteNotifier(amountIn, brandOut) {
            const pa = await paFor(amountIn.brand, brandOut);
            return E(pa).makeQuoteNotifier(amountIn, brandOut);
        },
        async quoteAtTime(deadline, amountIn, brandOut) {
            const pa = await paFor(amountIn.brand, brandOut);
            return E(pa).quoteAtTime(deadline, amountIn, brandOut);
        },
        /**
         * @param {Ratio} newPrice 
         */
        async setPrice(newPrice) {
            const pa = await  paFor(newPrice.numerator.brand, newPrice.denominator.brand);
            return E(pa).setPrice(newPrice);
        },
        // Regular quote methods
        quoteWhenLT: makeQuoteWhen('LT'),
        quoteWhenLTE: makeQuoteWhen('LTE'),
        quoteWhenGTE: makeQuoteWhen('GTE'),
        quoteWhenGT: makeQuoteWhen('GT'),
        // Mutable quote methods
        mutableQuoteWhenLT: makeMutableQuoteWhen('LT'),
        mutableQuoteWhenLTE: makeMutableQuoteWhen('LTE'),
        mutableQuoteWhenGTE: makeMutableQuoteWhen('GTE'),
        mutableQuoteWhenGT: makeMutableQuoteWhen('GT'),
    });
    trace('terms are sexxer ', zcf.getTerms());
    trace('manual price authority created ');
    /**
     * @param {Ratio} newPrice    
     * */
    const updatePrice = async (newPrice) => {
        const pa = paFor(newPrice.numerator.brand, newPrice.denominator.brand);
        await E(pa).setPrice(newPrice);

        const timestamp = await E(timer).getCurrentTimestamp();
        const recorderKit = recorderFor(newPrice.numerator.brand, newPrice.denominator.brand);
        const [nameIn, nameOut] = await Promise.all([
            E(newPrice.numerator.brand).getAllegedName(),
            E(newPrice.denominator.brand).getAllegedName(),
        ]);
        assert(recorderKit, `No recorder for ${nameIn} -> ${nameOut}`);
         
    const [brandInInfo, brandOutInfo] = await Promise.all([
        E(newPrice.numerator.brand).getDisplayInfo(),
        E(newPrice.denominator.brand).getDisplayInfo(),
    ]);

    const [brandIn, brandOut ] = await Promise.all([
        newPrice.numerator.brand,
        newPrice.denominator.brand
    ])
        await recorderKit.recorder.write({
            amountIn: {
                amount: AmountMath.make(brandIn, newPrice.numerator.value),
                displayInfo: {
                    decimalPlaces: brandInInfo.decimalPlaces || DEFAULT_DECIMAL_PLACES,
                },
            },
            amountOut: {
                amount: AmountMath.make(brandOut, newPrice.denominator.value),
                displayInfo: {
                    decimalPlaces: brandOutInfo.decimalPlaces || DEFAULT_DECIMAL_PLACES,
                },
            },
            lastUpdated: timestamp,
        }/** @type {PriceQuoteRecord} */);
        trace('price updated');
    };

    /**
     * 
     * @param {ZCFSeat} seat 
     * @param {{newPrice: Ratio}} offerArgs 
     * @returns 
     */
    const updatePriceHandler = async (seat, offerArgs) => {
        // TODO qn: does this have access to brand in and brand out from the
        // environment we're calling from??
        const newPrice = offerArgs.newPrice;
        await updatePrice(newPrice);

        // try recurse?
        // TODO check best practices - ask 
        const nextInvitation = zcf.makeInvitation(
            updatePriceHandler,
            'update Price Nexter ',
            {
                description: 'we always get this invitation after updating price',
            },
        );

        seat.exit(); // TODO should we exit here? Ask 
        const message = `Price updated for pair ${newPrice.denominator.brand} - ${newPrice.numerator.brand} as ${newPrice.denominator.value}: ${newPrice.numerator.value} `;
        return harden({
            nextInvitation,
            message,
        })
    };
    /**
     * Creates an invitation maker for persistent price updates
     * @param {Brand} brandIn 
     * @param {Brand} brandOut 
     */
    const makePriceUpdateInvitationMaker = (brandIn, brandOut) => {
        return Far('PriceUpdateInvitationMaker', {
            makeInvitation: () =>
                zcf.makeInvitation(
                    updatePriceHandler,
                    'update price',
                    {
                        description: 'Update price for pair',
                        brands: { brandIn, brandOut }
                    },
                ),
        });
    };

    /**
     * returns continuing invitation 
     * @param {ZCFSeat} seat 
     * @param {{brandIn: Brand<'nat'>, brandOut: Brand<'nat'>}} offerArgs 
     */
    const registerPairHandler = async (seat, offerArgs) => {
        const { brandIn, brandOut } = offerArgs;
        await registerPricePair(brandIn, brandOut);
        // this can be shared by the holder. Constrain to the pair in question
        const invitationMakers = makePriceUpdateInvitationMaker(brandIn, brandOut);
        // we give this immediately so the holdeer can update the price for pair in one go
        const firstInvitation = invitationMakers.makeInvitation();

        // TODO exit? guess work
        seat.exit();
        return harden({
            invitationMakers,
            firstInvitation,
        });
    };

    //TODO test if offerhandler has access to scope of objects within the environment of invitation maker???
    const registerPairInvitationP = zcf.makeInvitation(registerPairHandler, 'Register Onramp Pair Price Authority');

    const oracleAddressDepositFacet = await E(namesByAddress).lookup(ORACLE_ADDRESS, 'depositFacet');

    registerPairInvitationP.then(pmt => E(oracleAddressDepositFacet).receive(pmt)).catch(trace);

    trace('payment for oracle sent or failed. Dont know');

    const publicFacet = Far('OnrampPAPublic', {
        getQuoteIssuer: (brandIn, brandOut) =>
            E(priceAuthority).getQuoteIssuer(brandIn, brandOut),
        quoteGiven: (amountIn, brandOut) =>
            E(priceAuthority).quoteGiven(amountIn, brandOut),
        quoteWanted: (brandIn, amountOut) =>
            E(priceAuthority).quoteWanted(brandIn, amountOut),
        makeQuoteNotifier: (amountIn, brandOut) =>
            E(priceAuthority).makeQuoteNotifier(amountIn, brandOut),
        updatePrice,
        registerPricePair,

        /**
         * ##TODO more worik to do on this - scope price updates  * 
         * @param {ERef<Brand>} brandIn 
         * @param {ERef<Brand>} brandOut 
         * @returns {Promise<Invitation>}
         */
        registerNewPair: async (brandIn, brandOut) => {
            const invitation = zcf.makeInvitation(
                registerPairHandler,
                'Register Onramp Price Pair Authority'
            );
            return invitation;
        },
    });

    // TODO: Add admin facet??
    return harden({
        // creatorFacet,
        publicFacet,
    });
};

harden(start);
export { start };

/** @typedef {Awaited<ReturnType<typeof start>>['publicFacet']} PriceAuthorityPublicFacet */
