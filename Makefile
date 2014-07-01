.PHONY: all build

all: build

build: node_modules

dist: clean build src config/requirejs.conf.js test
	./node_modules/requirejs/bin/r.js -o ./config/build.conf.js

# if package.json changes, install
node_modules: package.json
	npm install
	touch $@

node_modules/requirejs: package.json
	npm install

server: build
	npm start

testdev: build
	# Run test in dev mode (watch, no Phantom)
	./node_modules/karma/bin/karma start

test: build
	# Run tests in jenkins mode (once, Phantom, JUnit reporter)
	npm test

clean:
	git clean -dfx
	sleep 1 && touch package.json

package: dist

env=dev
deploy: dist
	./node_modules/.bin/lfcdn -e $(env)
