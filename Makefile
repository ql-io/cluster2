all: clean install test

clean:
	-rm -fr node_modules

install:
	npm install;\
	npm link;

.PHONY : test
test: 
	export NODE_PATH=./node_modules;\
	node_modules/nodeunit/bin/nodeunit test

test-part:
	export NODE_PATH=./node_modules;\
	node_modules/nodeunit/bin/nodeunit test--reporter dot --output ../../reports

unpublish:
	npm --registry $(REGISTRY) unpublish

publish:
	npm --registry $(REGISTRY) publish

refresh:
	npm --registry $(REGISTRY) publish --force
