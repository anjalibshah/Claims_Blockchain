'use strict';
/* global process */
/* global __dirname */

var express = require('express');
var session = require('express-session');
var compression = require('compression');
var path = require('path');
var morgan = require('morgan');
var bodyParser = require('body-parser');
var http = require('http');
var app = express();
var url = require('url');
var setup = require('./setup');
var fs = require('fs');
var cors = require('cors');
var host = setup.SERVER.HOST;
var port = setup.SERVER.PORT;
var extend = require('extend');
var Ibc1 = require('ibm-blockchain-js');
var ibc = new Ibc1();
var peers = null;
var users = null;
var chaincode = null;

var GDS = require('ibm-graph-client');
var GDScreds = null;

var md5 = require('md5');

//Set your graph database title here
var graph = "graphdbclaims";

app.use(compression());
app.use(morgan('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded());

app.options('*', cors());
app.use(cors());

if (process.env.VCAP_SERVICES) {
    var servicesObject = JSON.parse(process.env.VCAP_SERVICES);
    for (var i in servicesObject) { 
	if (servicesObject[i][0].name.indexOf("lockchain") >= 0) {
            if (servicesObject[i][0].credentials && servicesObject[i][0].credentials.peers) {
                console.log('overwritting peers, loading from a vcap service: ', i);
                peers = servicesObject[i][0].credentials.peers;
                if (servicesObject[i][0].credentials.users) { //user field may or maynot exist, depends on if there is membership services or not for the network
                    console.log('overwritting users, loading from a vcap service: ', i);
                    users = servicesObject[i][0].credentials.users;
                } else users = null;
            }
        }
        if (i.indexOf('IBM Graph') >= 0) {
            if (servicesObject[i][0].credentials) {
                console.log('loading graph from a vcap service: ', i);
                GDScreds = servicesObject[i][0].credentials;
            }
        }
    }
}

var graphD = new GDS(GDScreds);

graphD.session(function(err, data) {
    if (err) {
        console.log(err);
    } else {
        graphD.config.session = data;
        console.log("Your graph session token is " + data);
    }
});


graphD.graphs().set(graph, function(err, data) {
    if (err) {
        console.log("Graph error:" + err);
    }
    console.log("Set active Graph:" + graph);
});

//see if peer 0 wants tls or no tls
function detect_tls_or_not(peer_array) {
    var tls = false;
    if (peer_array[0] && peer_array[0].api_port_tls) {
        if (!isNaN(peer_array[0].api_port_tls)) tls = true;
    }
    return tls;
}

// ==================================
// configure options for ibm-blockchain-js sdk
// ==================================
var options = {
    network: {
        //users: no - we are using an anon blockchain for this
	peers: [peers[0]],
        options: {
            quiet: true,
            tls: false, 
            maxRetry: 1 
        }
    },
    chaincode: {
        zip_url: 'https://github.com/anjalibshah/Claims_Blockchain/archive/master.zip',
        unzip_dir: 'Claims_Blockchain-master/chaincode',
        git_url: 'https://github.com/anjalibshah/Claims_Blockchain/chaincode'
    }
};

ibc.load(options, function(err, cc) { 
    if (err != null) {
        console.log('! looks like an error loading the chaincode or network, app will fail\n', err);
        if (!process.error) process.error = {
            type: 'load',
            msg: err.details
        }; //if it already exist, keep the last error
    } else {
        chaincode = cc;
        if (!cc.details.deployed_name || cc.details.deployed_name === '') { //yes, go deploy
            cc.deploy('init', ['99'], {
                delay_ms: 30000
            }, function(e) { //delay_ms is milliseconds to wait after deploy for conatiner to start, 50sec recommended
                check_if_deployed(e, 1);
            });
        } else { //no, already deployed
            console.log('chaincode summary file indicates chaincode has been previously deployed');
            check_if_deployed(null, 1);
        }
    }
});


function check_if_deployed(e, attempt) {
    if (e) {
        cb_deployed(e); //looks like an error pass it along
    } else if (attempt >= 15) { //tried many times, lets give up and pass an err msg
        console.log('[preflight check]', attempt, ': failed too many times, giving up');
        var msg = 'chaincode is taking an unusually long time to start. this sounds like a network error, check peer logs';
        if (!process.error) process.error = {
            type: 'deploy',
            msg: msg
        };
        cb_deployed(msg);
    } else {
        console.log('[preflight check]', attempt, ': testing if chaincode is ready');
        chaincode.query.read(['_claimindex'], function(err, resp) {
            var cc_deployed = false;
            try {
                if (err == null) { //no errors is good, but can't trust that alone
                    if (resp === 'null') cc_deployed = true; //looks alright, brand new, no claims yet
                    else {
                        var json = JSON.parse(resp);
                        if (json.constructor === Array) cc_deployed = true; //looks alright, we have claims
                    }
                }
            } catch (e) {} //anything nasty goes here
            if (!cc_deployed) {
                console.log('[preflight check]', attempt, ': failed, trying again');
                setTimeout(function() {
                    check_if_deployed(null, ++attempt); //no, try again later
                }, 10000);
            } else {
                console.log('[preflight check]', attempt, ': success');
                cb_deployed(null); //yes, lets go!
            }
        });
    }
}

function cb_deployed(e) {
    if (e != null) {
        console.log('Deploy error: \n', e);
        if (!process.error) process.error = {
            type: 'deploy',
            msg: e.details
        };
    } else {
        console.log('Deployed Sucessfully\n');
    }
}


app.use(function(req, res, next) {
    var keys;
    console.log('------------------------------------------ incoming request ------------------------------------------');
    console.log('New ' + req.method + ' request for', req.url);

    var url_parts = url.parse(req.url, true);
    req.parameters = url_parts.query;
    keys = Object.keys(req.parameters);
    if (req.parameters && keys.length > 0) console.log({
        parameters: req.parameters
    });
    keys = Object.keys(req.body);
    if (req.body && keys.length > 0) console.log({
        body: req.body
    });
    next();
});

var router = express.Router();
var routerRoot = express.Router();

routerRoot.all('/', function(req, res) {
    res.json({
        message: 'This is a webapp, so nothing to see here.'
    });
});

router.route('/').all(function(req, res) {
    res.json({
        message: 'Available commands are create, delete, query, and graphinit'
    });
});

router.route('/create').post(function(req, res) {
    chaincode.invoke.init_claim([req.body.dcn, req.body.claimnumber, req.body.diagnosis, req.body.provider, req.body.providertext, req.body.claimanttext, 
        req.body.rtn2work], retCall);
	
    function retCall(e, a) {
        console.log('Blockchain created entry: ', e, a);
    }
    var gremlinq = {
        gremlin: "\
	def claimV = graph.addVertex(T.label, 'claim', 'dcn', dcn, 'hash', hash, 'claimnumber', claimnumber);\
	def providerV =  graph.traversal().V().has('provider',provider);\
	providerV =  providerV.hasNext() ? providerV.next() : graph.addVertex(T.label, 'provider', 'provider', provider);\
	def diagnosisV =  graph.traversal().V().has('diagnosis',diagnosis);\
	diagnosisV =  diagnosisV.hasNext() ? diagnosisV.next() : graph.addVertex(T.label, 'diagnosis', 'diagnosis', diagnosis);\
	claimV.addEdge('provider', providerV);\
	claimV.addEdge('diagnosis', diagnosisV);",
        "bindings": {
            "provider": req.body.provider,
            "diagnosis": req.body.diagnosis,
            "dcn": req.body.dcn,
            "claimnumber": req.body.claimnumber,
            "claimanttext": req.body.claimanttext,
            "rtn2work": req.body.rtn2work,
            "hash": md5(req.body.providertext)
        }
    }
    graphD.gremlin(gremlinq, function(err, data) {
        if (err) {
            console.log(err);
        }
        console.log(JSON.stringify(data));
    });
    res.json({
        message: 'Transaction Complete'
    });
});

router.route('/index').post(function(req, res) {
    chaincode.query.read(['_claimindex'], function(e, a) {
        console.log('Index returns: ', e, a);
        res.json(a);
    });
});

router.route('/delete').post(function(req, res) {
var gremlinq = {
        gremlin: "\
	graph.traversal().V().has('claim','" + req.body.claimnumber + "').drop();\
	graph.tx().commit();",
        "bindings": {}
    }
    graphD.gremlin(gremlinq, function(err, data) {
        if (err) {
            console.log(err);
        }
        console.log(JSON.stringify(data));
    });
    try{
	    chaincode.invoke.delete([req.body.claimnumber], function(e, a) {
		console.log('Blockchain returns: ', e, a);
		res.json(a);
	    });
    }
    catch(fail){
	    console.log('Blockchain out of sync with Graph');
    }
});

router.route('/query').post(function(req, res) {
    res.writeHead(200, {
        'Content-Type': 'application/json'
    });
	res.write("[");
    var gremlinq = {
        "gremlin": "graph.traversal().V().has('"+ req.body.type +"', '"+ req.body.value +"').inE().outV();",
        "bindings": {}
    }
    graphD.gremlin(gremlinq, function(err, odata) {
        if (err) {
            console.log('Error: ' + err);
        }
        console.log(JSON.stringify(odata));
        var resnum = 0;
        var claim = null;
        for (var i = 0, len = odata.result.data.length; i < len; i++) {
            claim = odata.result.data[i].properties.name[0].value;
            console.log('Claim found in Graph: ' + claim);
	    try{
		    chaincode.query.read([claim], function(e, a) {
			console.log('Blockchain returns: ', e, a);
			res.write(a);
			resnum++;
			if (resnum == odata.result.data.length) {
			    res.write("]");
			    res.end();
			} else {
			    res.write(",");
			}
		    });
	    }
	    catch(fail){
		    console.log('Blockchain out of sync with Graph');
	    }
        }
    });
});

router.get('/graphinit', function(req, res) {
    var schema = {
        "propertyKeys": [{
                "name": "dcn",
                "dataType": "String",
                "cardinality": "SINGLE"
            },
            {
                "name": "claimnumber",
                "dataType": "String",
                "cardinality": "SINGLE"
            },
            {
                "name": "diagnosis",
                "dataType": "String",
                "cardinality": "SINGLE"
            },
            {
                "name": "provider",
                "dataType": "String",
                "cardinality": "SINGLE"
            },
            {
                "name": "claimanttext",
                "dataType": "String",
                "cardinality": "SINGLE"
            },
            {
                "name": "rtn2work",
                "dataType": "String",
                "cardinality": "SINGLE"
            },
            {
                "name": "hash",
                "dataType": "String",
                "cardinality": "SINGLE"
            }
        ],
        "vertexLabels": [{
                "name": "provider"
            },
            {
                "name": "claim"
            },
            {
                "name": "diagnosis"
            }
        ],
        "edgeLabels": [{
                "name": "providers",
                "multiplicity": "MULTI"
            },
            {
                "name": "diagnoses",
                "multiplicity": "MULTI"
            }
        ],
        "vertexIndexes": [{
                "name": "vByDiagnosis",
                "propertyKeys": ["diagnosis"],
                "composite": true,
                "unique": false
            },
            {
                "name": "vByProvider",
                "propertyKeys": ["provider"],
                "composite": true,
                "unique": false
            },
            {
                "name": "vByRtn2work",
                "propertyKeys": ["rtn2work"],
                "composite": true,
                "unique": false
            }
        ],
        "edgeIndexes": [{
                "name": "eByProviders",
                "propertyKeys": ["provider"],
                "composite": true,
                "unique": false
            },
            {
                "name": "eByDiagnoses",
                "propertyKeys": ["diagnosis"],
                "composite": true,
                "unique": false
            }
        ]
    }
    graphD.config.url = graphD.config.url.substr(0, graphD.config.url.lastIndexOf('/') + 1) + graph;
    graphD.schema().set(schema, function(err, data) {
        if (err) {
            console.log(err);
        }
        res.json(data);
    });
});

app.use('/api', router);
app.use('/', routerRoot);
app.use(function(req, res, next) {
    err.status = 404;
    next(err);
});
app.use(function(err, req, res, next) {
    console.log('Error Handler -', req.url);
    var errorCode = err.status || 500;
    res.status(errorCode);
    res.json({
        msg: err.stack,
        status: errorCode
    });
});


// ============================================================================================================================
// 														Launch Webserver
// ============================================================================================================================
var server = http.createServer(app).listen(port, function() {});
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.env.NODE_ENV = 'production';
server.timeout = 240000;
console.log('------------------------------------------ Server Up - ' + host + ':' + port + ' ------------------------------------------');
