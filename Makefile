#!/usr/bin/make -f

all:
	npm install --production
	
install:
	mkdir -p $(DESTDIR)/usr/lib/node_modules/fs-extended
	cp -a test node_modules package.json fs-extended.js $(DESTDIR)/usr/lib/node_modules/fs-extended