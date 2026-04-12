Testing
-------

* Discuss migration to Mocha testing framework
* Each API needs a testing mock. The testing mock serves a selection of prefetched, hardcoded but real data. The tests can then use real data for testing purposes. But we can also add some common sense tests against the real API's to check if the real API's are still working. Discuss if this is a good idea.


Composition
-----------

* Discuss composition of hard and soft filters in the custom WebGL layer

Exception handling
------------------

* Only catc those exceptions that should be handled gracefully and are to be expected during normal operation of the app.

ogc_client
mocha-chrome-headless