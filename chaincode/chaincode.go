package main

import (
	"errors"
	"fmt"
	"strconv"
	"encoding/json"
	"time"

	"github.com/hyperledger/fabric/core/chaincode/shim"
)

// SimpleChaincode example simple Chaincode implementation
type SimpleChaincode struct {
}

var claimIndexStr = "_claimindex"				//name for the key/value that will store a list of all known claims

type Claim struct{
	Dcn string `json:"dcn"`					
	ClaimNumber string `json:"claimnumber"`
	Diagnosis string `json:"diagnosis"`
	Provider string `json:"provider"`
	ProviderText string `json:"providertext"`
	ClaimText string `json:"claimanttext"`
	Rtn2Work string `json:"rtn2work"`
}




// ============================================================================================================================
// Main
// ============================================================================================================================
func main() {
	err := shim.Start(new(SimpleChaincode))
	if err != nil {
		fmt.Printf("Error starting Simple chaincode: %s", err)
	}
}

// ============================================================================================================================
// Init - reset all the things
// ============================================================================================================================
func (t *SimpleChaincode) Init(stub shim.ChaincodeStubInterface, function string, args []string) ([]byte, error) {
	var Aval int
	var err error

	if len(args) != 1 {
		return nil, errors.New("Incorrect number of arguments. Expecting 1")
	}

	// Initialize the chaincode
	Aval, err = strconv.Atoi(args[0])
	if err != nil {
		return nil, errors.New("Expecting integer value for asset holding")
	}

	// Write the state to the ledger
	err = stub.PutState("abc", []byte(strconv.Itoa(Aval)))				//making a test var "abc", I find it handy to read/write to it right away to test the network
	if err != nil {
		return nil, err
	}
	
	var empty []string
	jsonAsBytes, _ := json.Marshal(empty)								//marshal an emtpy array of strings to clear the index
	err = stub.PutState(claimIndexStr, jsonAsBytes)
	if err != nil {
		return nil, err
	}
	
	return nil, nil
}

// ============================================================================================================================
// Run - Our entry point for Invocations - [LEGACY] obc-peer 4/25/2016
// ============================================================================================================================
func (t *SimpleChaincode) Run(stub shim.ChaincodeStubInterface, function string, args []string) ([]byte, error) {
	fmt.Println("run is running " + function)
	return t.Invoke(stub, function, args)
}

// ============================================================================================================================
// Invoke - Our entry point for Invocations
// ============================================================================================================================
func (t *SimpleChaincode) Invoke(stub shim.ChaincodeStubInterface, function string, args []string) ([]byte, error) {
	fmt.Println("invoke is running " + function)

	// Handle different functions
	if function == "init" {													//initialize the chaincode state, used as reset
		return t.Init(stub, "init", args)
	} else if function == "delete" {										//deletes an entity from its state
		res, err := t.Delete(stub, args)													//lets make sure all open trades are still valid
		return res, err
	} else if function == "write" {											//writes a value to the chaincode state
		return t.Write(stub, args)
	} else if function == "init_claim" {									//create a new claim
		return t.init_claim(stub, args)
	} else if function == "set_user" {										//change owner of a claim
		res, err := t.set_user(stub, args)													//lets make sure all open trades are still valid
		return res, err
	} 
	fmt.Println("invoke did not find func: " + function)					//error

	return nil, errors.New("Received unknown function invocation")
}

// ============================================================================================================================
// Query - Our entry point for Queries
// ============================================================================================================================
func (t *SimpleChaincode) Query(stub shim.ChaincodeStubInterface, function string, args []string) ([]byte, error) {
	fmt.Println("query is running " + function)

	// Handle different functions
	if function == "read" {													//read a variable
		return t.read(stub, args)
	}
	fmt.Println("query did not find func: " + function)						//error

	return nil, errors.New("Received unknown function query")
}

// ============================================================================================================================
// Read - read a variable from chaincode state
// ============================================================================================================================
func (t *SimpleChaincode) read(stub shim.ChaincodeStubInterface, args []string) ([]byte, error) {
	var name, jsonResp string
	var err error

	if len(args) != 1 {
		return nil, errors.New("Incorrect number of arguments. Expecting name of the var to query")
	}

	name = args[0]
	valAsbytes, err := stub.GetState(name)									//get the var from chaincode state
	if err != nil {
		jsonResp = "{\"Error\":\"Failed to get state for " + name + "\"}"
		return nil, errors.New(jsonResp)
	}

	return valAsbytes, nil													//send it onward
}

// ============================================================================================================================
// Delete - remove a key/value pair from state
// ============================================================================================================================
func (t *SimpleChaincode) Delete(stub shim.ChaincodeStubInterface, args []string) ([]byte, error) {
	if len(args) != 1 {
		return nil, errors.New("Incorrect number of arguments. Expecting 1")
	}
	
	name := args[0]
	err := stub.DelState(name)													//remove the key from chaincode state
	if err != nil {
		return nil, errors.New("Failed to delete state")
	}

	//get the claim index
	claimsAsBytes, err := stub.GetState(claimIndexStr)
	if err != nil {
		return nil, errors.New("Failed to get claim index")
	}
	var claimIndex []string
	json.Unmarshal(claimsAsBytes, &claimIndex)								//un stringify it aka JSON.parse()
	
	//remove claim from index
	for i,val := range claimIndex{
		fmt.Println(strconv.Itoa(i) + " - looking at " + val + " for " + name)
		if val == name{															//find the correct claim
			fmt.Println("found claim")
			claimIndex = append(claimIndex[:i], claimIndex[i+1:]...)			//remove it
			for x:= range claimIndex{											//debug prints...
				fmt.Println(string(x) + " - " + claimIndex[x])
			}
			break
		}
	}
	jsonAsBytes, _ := json.Marshal(claimIndex)									//save new index
	err = stub.PutState(claimIndexStr, jsonAsBytes)
	return nil, nil
}

// ============================================================================================================================
// Write - write variable into chaincode state
// ============================================================================================================================
func (t *SimpleChaincode) Write(stub shim.ChaincodeStubInterface, args []string) ([]byte, error) {
	var name, value string // Entities
	var err error
	fmt.Println("running write()")

	if len(args) != 2 {
		return nil, errors.New("Incorrect number of arguments. Expecting 2. name of the variable and value to set")
	}

	name = args[0]															//rename for funsies
	value = args[1]
	err = stub.PutState(name, []byte(value))								//write the variable into the chaincode state
	if err != nil {
		return nil, err
	}
	return nil, nil
}

// ============================================================================================================================
// Init Claim - create a new claim, store into chaincode state
// ============================================================================================================================
func (t *SimpleChaincode) init_claim(stub shim.ChaincodeStubInterface, args []string) ([]byte, error) {
	var err error
	
	if len(args) != 7 {
		return nil, errors.New("Incorrect number of arguments. Expecting 7")
	}
	fmt.Println("- start init claim")
	dcn := args[0]
	claimnumber := args[1]
	diagnosis := args[2]
	provider := args[3]
	providertext := args[4]
	claimanttext := args[5]
	rtn2work := args[6]
	
	//check if claim already exists
	claimAsBytes, err := stub.GetState(dcn)
	if err != nil {
		return nil, errors.New("Failed to get claim dcn")
	}
	res := Claim{}
	json.Unmarshal(claimAsBytes, &res)
	if res.Dcn == dcn{
		fmt.Println("This claim arleady exists: " + dcn)
		fmt.Println(res);
		return nil, errors.New("This claim arleady exists")				//all stop a claim by this number exists
	}
	
	//build the claim json string manually
	str := `{"dcn": "` + dcn + `", "claimnumber": "` + claimnumber + `", "diagnosis": "` + diagnosis + `", "provider": "` + provider + `", "providertext": "` + providertext + `", "claimanttext": "` + claimanttext + `", "rtn2work": "` + rtn2work + `"}`
	err = stub.PutState(dcn, []byte(str))									//store claim with id as key
	if err != nil {
		return nil, err
	}
		
	//get the claim index
	claimsAsBytes, err := stub.GetState(claimIndexStr)
	if err != nil {
		return nil, errors.New("Failed to get claim index")
	}
	var claimIndex []string
	json.Unmarshal(claimsAsBytes, &claimIndex)							//un stringify it aka JSON.parse()
	
	//append
	claimIndex = append(claimIndex, dcn)									//add claim dcn to index list
	fmt.Println("! Claim index: ", claimIndex)
	jsonAsBytes, _ := json.Marshal(claimIndex)
	err = stub.PutState(claimIndexStr, jsonAsBytes)						//store dcn of claim

	fmt.Println("- end init claim")
	return nil, nil
}

// ============================================================================================================================
// Set User Permission on Claim
// ============================================================================================================================
func (t *SimpleChaincode) set_user(stub shim.ChaincodeStubInterface, args []string) ([]byte, error) {
	var err error
	
	if len(args) < 2 {
		return nil, errors.New("Incorrect number of arguments. Expecting 2")
	}
	
	fmt.Println("- start set dcn")
	fmt.Println(args[0] + " - " + args[1])
	claimAsBytes, err := stub.GetState(args[0])
	if err != nil {
		return nil, errors.New("Failed to get thing")
	}
	res := Claim{}
	json.Unmarshal(claimAsBytes, &res)										//un stringify it aka JSON.parse()
	res.ClaimNumber = args[1]														//change the user
	
	jsonAsBytes, _ := json.Marshal(res)
	err = stub.PutState(args[0], jsonAsBytes)								//rewrite the claim with id as key
	if err != nil {
		return nil, err
	}
	
	fmt.Println("- end set user")
	return nil, nil
}

// ============================================================================================================================
// Make Timestamp - create a timestamp in ms
// ============================================================================================================================
func makeTimestamp() int64 {
    return time.Now().UnixNano() / (int64(time.Millisecond)/int64(time.Nanosecond))
}

