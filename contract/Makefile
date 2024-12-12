CHAINID=agoriclocal
USER1ADDR=$(shell agd keys show user1 -a --keyring-backend="test")
ACCT_ADDR=$(USER1ADDR)
BLD=000000ubld

AGENT_ADDR=agoric1vl6rhhjj57npl0c0kypvuz7zhnjrvevtqf8kt8

USERADDR=agoric12n6dapqwszh39y24kpc3gty7eeudnzm2ank89c

ATOM_DENOM=ibc/BA313C4A19DFBF943586C0387E6B11286F9E416B4DD27574E6909CABE0E342FA
ATOM=000000$(ATOM_DENOM)

.PHONY: list
# https://stackoverflow.com/a/73159833/7963
list:
	@make -npq : 2> /dev/null | grep -v PHONY |\
		awk -v RS= -F: '$$1 ~ /^[^#%]+$$/ { print $$1 }'

balance-q:
	agd keys show user1 -a --keyring-backend="test"
	agd query bank balances $(ACCT_ADDR)

GAS_ADJUSTMENT=1.2
SIGN_BROADCAST_OPTS=--keyring-backend=test --chain-id=$(CHAINID) \
		--gas=auto --gas-adjustment=$(GAS_ADJUSTMENT) \
		--yes -b block

# provisionWallet:
# 	agd tx swingset provision-one <nickname> <address> [<power-flag>[,...]] [flags]


mint100:
	make FUNDS=1000$(ATOM) fund-acct
	cd /usr/src/agoric-sdk && \
		yarn --silent agops vaults open --wantMinted 100 --giveCollateral 100 >/tmp/want-ist.json && \
		yarn --silent agops perf satisfaction --executeOffer /tmp/want-ist.json --from user1 --keyring-backend=test

mint100-agent:
	make FUNDS=1000$(ATOM) fund-acct-agent
	cd /usr/src/agoric-sdk && \
		yarn --silent agops vaults open --wantMinted 100 --giveCollateral 100 >/tmp/want-ist.json && \
		yarn --silent agops perf satisfaction --executeOffer /tmp/want-ist.json --from user1 --keyring-backend=test
# Keep mint4k around a while for compatibility
mint4k:
	make FUNDS=1000$(ATOM) fund-acct
	cd /usr/src/agoric-sdk && \
		yarn --silent agops vaults open --wantMinted 4000 --giveCollateral 1000 >/tmp/want4k.json && \
		yarn --silent agops perf satisfaction --executeOffer /tmp/want4k.json --from user1 --keyring-backend=test

FUNDS=321$(BLD)
fund-acct:
	agd tx bank send validator $(ACCT_ADDR) $(FUNDS) \
	  $(SIGN_BROADCAST_OPTS) \
	  -o json >,tx.json
	jq '{code: .code, height: .height}' ,tx.json

fund-acct-agent:
	agd tx bank send validator $(AGENT_ADDR) $(FUNDS) \
	  $(SIGN_BROADCAST_OPTS) \
	  -o json >,tx.json
	jq '{code: .code, height: .height}' ,tx.json

gov-q:
	agd query gov proposals --output json | \
		jq -c '.proposals[] | [.proposal_id,.voting_end_time,.status]'

gov-voting-q:
	agd query gov proposals --status=voting_period --output json | \
		jq -c '.proposals[].proposal_id'

PROPOSAL=1
VOTE_OPTION=yes
vote:
	agd tx gov vote $(PROPOSAL) $(VOTE_OPTION) --from=validator \
	  $(SIGN_BROADCAST_OPTS) \
	  -o json >,tx.json
	jq '{code: .code, height: .height}' ,tx.json

instance-q:
	agd query vstorage data published.agoricNames.instance -o json

print-key: /root/.agoric/user1.key
	@echo Import the following mnemonic into Keplr:
	@cat $<
	@echo
	@echo -n 'The resulting address should be: '
	@agd keys show user1 -a --keyring-backend="test"
	@echo

start-contract: start-price-authority start-contract-onramp  

start-contract-onramp:
	yarn node scripts/deploy-contract.js \
		--install src/onramp.contract.js \
		--eval src/platform-goals/board-aux.core.js \
		--eval src/onramp.proposal.js

start-contract-gimix:
	yarn node scripts/deploy-contract.js \
		--install src/gimix.contract.js \
		--eval src/gimix.proposal.js

start-contract-zend:
	yarn node scripts/deploy-contract.js \
		--install src/zend.contract.js  \
		--eval src/zend.proposal.js

start-price-authority: 
	yarn node scripts/deploy-contract.js \
		--install src/onrampPriceRegistry.contract.js \
		--eval src/onrampPriceRegistry.proposal.js 


# bundle-X.json.installed show that bundle-X.json was installed
# see also e2e-tools.js
%.json.installed: %.json
	@echo '{"up-to-date": false}'

# X.js.done shows that X.js core eval ran
%.js.done: %.js
	@echo '{"up-to-date": false}'

# Dependencies to re-run core eval when source changes
# NOTE: manually updated

# bundles/deploy-onramp.js: src/onramp.proposal.js
# 	@echo '{"up-to-date": true}'

# bundles/deploy-gimix.js: src/gimix.proposal.js
# 	@echo '{"up-to-date": true}'

clean:
	@rm -rf bundles/

# -mpesa-contract:
# 	@echo "Sending M-PESA message to the contract..."
# 	@MPESA_MESSAGE="ABC123 Confirmed. Ksh1,000.00 sent to John Doe on 01/01/23 at 12:00 PM" && \
# 	ENCODED_MESSAGE=$$(echo -n "$$MPESA_MESSAGE" | base64) && \
# 	OFFER_CONFIG='{"id":"processMpesaMessage","invitationSpec":{"source":"contract","instancePath":["mpesaParser"],"publicInvitationMaker":"makeProcessInvitation"},"proposal":{"give":{"Message":"'$$ENCODED_MESSAGE'"}}}' && \
# 	WALLET_callACTION='{"method":"executeOffer","offer":'$$OFFER_CONFIG'}' && \
# 	MARSHALLED_ACTION=$$(echo -n "$$WALLET_ACTION" | jq -c -R '{"body": ("#" + .), "slots": []}' | jq -c -R .) && \
# 	agd tx swingset wallet-action \
# 		--allow-spend "$$MARSHALLED_ACTION" \
# 		--chain-id=$(CHAINID) \
# 		--from=user1 \
# 		--gas=auto \
# 		--gas-adjustment=$(GAS_ADJUSTMENT) \
# 		-y \
# 		$(SIGN_BROADCAST_OPTS)
# 	@echo "Message sent to the contract."

