// possible changes on input...
var proposals = null;
// this is called for any statement during testing. if you create an infinite loop, this will stop it.
var __dead_man_switch = null;

var fuzz = function(input, tests){
	// this cache basically prevents duplicate attempts from being made. since the results for a certain attempt never changes, this cache will help us :)
	var cache = {};

	var maxAttempts = 20;
	var currentAttempts = 0;

	document.getElementById('result').value = '';

	// initialize and parse
	var tree = [];
	var tokenizer = new Tokenizer(input);
	var parser = new ZeParser(input, tokenizer, tree);
	parser.parse();
	parser.tokenizer.fixValues(); // make sure all tokens have their .value set (default parser doesnt do this)
	
	var minInput = minify(parser);
	var lastMin = 0;

	// this will be our fuzzer. it will use the generated stuff from above and repetitively just... try :) barring cache of course	
	var fuzz = function(){
		++currentAttempts;
		if (currentAttempts >= maxAttempts) {
			var s = '\n';
			s += "maxAttempts reached! Winner:\n";
			var minLen = Infinity;
			var maxValue = '';
			for (var key in cache) if (cache.hasOwnProperty(key)) {
				if (key.length < minLen) {
					maxValue = key;
					minLen = key.length;
				}
			}
			s += lastMin+' (original: '+minInput.length+')\n';
			s += maxValue;
			
			document.getElementById('result').value += s;
			return;
		}

		// initialize and parse
		var tree = [];
		var tokenizer = new Tokenizer(input);
		var parser = new ZeParser(input, tokenizer, tree);
		parser.parse();
		parser.tokenizer.fixValues(); // make sure all tokens have their .value set (default parser doesnt do this)
		
		// array with transformation functions
		proposals = [];
		
		// sweep for possible tricks to apply
		sweep(tree, parser);
		
		// generate all permutations or fuzz them
		//var permutations = proposals.length * proposals.length;

		proposals.forEach(function(arr,i){ // [method, stack, index]
			var no = Math.random() > 0.5;
			if (no) return; // "50% chance"
			// get the method and replace it with the parser instance
			var method = arr[0];
			arr[0] = parser;
			// basically does: reWriters.method(parser, stack, index)
			reWriters[method].apply(this, arr);
		},this);
	
		// reconstruct the new code to a string
		var newInput = parser.tokenizer.wtree.map(function(t){ return t.value; }).join('');

		if (!cache[newInput]) {
			// parse new version (we need it to inject code)
			var tree2 = [];	
			var tokenizer2 = new Tokenizer(newInput);
			var parser2 = new ZeParser(newInput, tokenizer2, tree2);
			parser2.parse();

			var min2 = minify(parser2);
			lastMin = min2.length;

			// construct ast and inject dead man switch
			Ast.injectName = '__dead_man_switch';
			var ast = new Ast(tree2, tokenizer2.btree);
			var insCode = ast.heatmap();

			// respawn here to reset the counter
			__dead_man_switch = function(){
				var arr = [];
				return function(n){
					arr[n] = -~arr[n]; // ghetto op! thanks jed! (this is ++n that works on unintialized n's too)
					if (n > 100000000) throw 'dead_man_switch thrown...';
				};
			};
			
			// for each test, test...
			var failed = tests.filter(function(testFunc){
				// make sure the code is syntactically valid
				try {
					// create a new function. i dont think this is actually necessary, but just in case. (closures, property expandos, etc)
					var resfunc = eval('('+insCode+')');
				} catch(e){
					console.log("invalid func generated");
					return true;
				}
		
				// code shouldnt throw an error and shouldnt run rampant
				try {
					testFunc(resfunc);
				} catch(e){
					console.log("Failed test:", e, testFunc);
					return true;
				}
			},this);
			
			if (failed.length) cache[newInput] = -1; // indicate failure (but not falsy)
			else cache[newInput] = 1; // success
			document.getElementById('result').value += min2.length+': '+min2+'\n';
		}
		
		setTimeout(fuzz, 200);
	};
	
	fuzz();
};

// basic version from zeon.js
var minify = function(parser){
	// we need the original tree because we need to
	// take restricted productions into account.
	var tree = parser.tokenizer.wtree;
	if (tree.length == 0) return '';
	// (cannot use btree because we need the line terminators to determine ASI conditions... i think)
	// ok first remove all whitespace and comments (multi comments as long as they dont contain newlines)
	var tokens = tree.filter(function(o){ return o.name != 7/*COMMENT_SINGLE*/ && o.name != 9/*WHITE_SPACE*/ && !(o.name == 8/*COMMENT_MULTI*/ && !o.hasNewline); });
	// then remove all lineterminators that dont follow a flow statement
	var n = tokens.length;
	while (n--) {
		if (tokens[n].hasNewline && !tokens[n].isString) {
			if (n == 0 || !tokens[n-1].restricted) {
				tokens.splice(n, 1);
			}
		}
	}
	// now all non-significant line terminators and any other whitespace are gone

	// rebuild the source. certain tokens need
	// a space to seperate them from other tokens.
	// namely: identifiers need to be separated from
	// other identifiers (be they vars or operators)
	// so if the current token is an identifier and
	// the next token is too, put a space in between
	// them. otherwise dont.
	// there is no valid context where two numbers 
	// may be adjacent to each other.
	// there must be a space between an identifier left
	// and a number right. not otherway round since
	// identifiers cannot start with a number
	var sliced = tokens.slice(0); // copy array, we're gonna mess it up
	var n = sliced.length;
	while (--n) { // yes, we dont use 0 in this loop
		var left = sliced[n-1];
		var right = sliced[n];
		// replace all asi's with a semi, unless we want newlines
		if (right.name == 13/*asi*/) {
			right.value = ';';
		}
		// space if identifier~identifier or identifier~number
		var space = left.name == 2/*identifier*/ && (right.name == 2/*identifier*/ || right.isNumber);
		// special case, also keep space if number~. and number doesnt contain a dot.
		space = space || (left.isNumber && right.value == '.' && (left.value.indexOf('.') < 0));
		// very special case, if two tokens contain either only plusses or minusses, dont combine them. it might introduce an error or change token to which pre/postfix belongs to
		space = space || ( left.value == '+' && (right.value == '+' || right.value == '++'));
		space = space || (left.value == '-' && (right.value == '-' || right.value == '--'));
		if (right.isString) {
			sliced[n] = sliced[n].value.replace(/\\\n/g,''); // remove non-contributing line continuations
		}
		else sliced[n] = right.value;
		if (space) sliced.splice(n, 0, ' ');
	}
	sliced[n] = sliced[n].value;

	return sliced.join('');
};

// this is where you do detection for all the rewrite rules
// check for certain patterns and circumstances
// if the pattern matches, add rewrite method name, stack and index to the array of proposals
// the fuzzer will then, at each attempt, for each such proposal determine whether it does or does not apply the rewrite
// most difficult part is adding the detection below. just use the stack and streams to get this done. rest is easy.
var sweep = function(stack, parser){
	stack.forEach(function(token, index){
		if (token instanceof Array) { // stack
			sweep(token, parser);
		} else { // actual token
			if (token.value == 'charAt' && token.isPropertyName) {
				// propose accessing string as array
				proposals.push(['charAt', stack, index]);
			} else if (token.value == 'if' && token.statementStart) {

				// only rewrite if the if-body statement is actually an expression-statement (otherwise it would not be valid, either way)
				var ifStack = stack.filter(function(s){ return s.desc == 'statement-parent'; })[0][0];
				if (ifStack.sub == 'expression' || ifStack.desc == 'expressions') {
					if (token.hasElse) { // if-else, rewrite to ? :
						var elseStack = stack.filter(function(s){ return s.sub == 'else'; })[0]; // else stack
						elseStack = elseStack.filter(function(s){ return s.desc == 'statement-parent'; })[0][0]; // statement-parent, statement
						// don't rewrite if statement is not an expression-statement (would not be valid)
						if (elseStack.sub == 'expression' || elseStack.desc == 'expressions') {
							proposals.push(['ifElse', stack, index]);
						}
					} else { // just an `if`, rewrite to &&
						proposals.push(['if', stack, index]);
					}
				}
			} else if (token.value == 'true' && !token.isPropertyName) {
				proposals.push(['true', stack, index]);
			} else if (token.value == 'false' && !token.isPropertyName) {
				proposals.push(['false', stack, index]);
			}
		}
	}, this);
};

var reWriters = {
	charAt: function(parser, stack, index){
		// <expr1>.charAt(<expr2>)
		// -> 
		// <expr1>[<expr2>]
		
		var tree = parser.tokenizer.btree;
		index = stack[index].tokposb; // get btree index
		
		tree[index].value = '';
		tree[index-1].value=''; // dot
		tree[index+1].value='['; // (
		tree[index+1].twin.value=']'; // )
	},
	'if': function(parser, stack, index){
		var tree = parser.tokenizer.btree;
		var token = tree[stack.nextBlack];

		token.value = ''; // if
		tree[token.tokposb+1].value = ''; // (
		tree[token.tokposb+1].twin.value = '&&'; // )
	},
	'ifElse': function(parser, stack, index){
		var tree = parser.tokenizer.btree;
		var token = tree[stack.nextBlack];

		token.value = ''; // if
		tree[token.tokposb+1].value = ''; // (
		tree[token.tokposb+1].twin.value = '?'; // )
		token.hasElse.value = ':'; // )
		// we must also remove the semi/asi BEFORE the else token, if it exists (might not, but only due to block, which cant exist at this point)
		var prev = tree[token.hasElse.tokposb-1];
		if (prev && (prev.value == ';' || prev.name == 13/*ASI*/)) prev.value = '';
	},
	'true': function(parser, stack, index){
		stack[index].value = '1';
	},
	'false': function(parser, stack, index){
		stack[index].value = '0';
	}
};

(document.getElementsByTagName('button')[0].onclick = function(){
	var code = document.getElementById('code').value;
	var tests = eval('('+document.getElementById('tests').value+')');
	fuzz(code, tests);
})();
