#!/usr/bin/env bash

echo "Please enter your application url: "
read appRoute

IN="{\"dcn\": \"140512F09460\", \"claimnumber\": \"751404090439\", \"providertext\": \" Patient Will Never return to work In Any Capacity. \", \"diagnosis\": \"end stage osteoarthritis\", \"provider\": \"71379555555\", \"claimanttext\": \"Get Up - Make Bed - Fix My Breakfast Watch Tv Go For Short Walk. I Cannot Travel As Far As Before My KneeS And Legs Start Hurting.\", \"rtn2work\": \"No\"}| {\"dcn\": \"140627F08341\", \"claimnumber\": \"600707121730\", \"providertext\": \" Pt Was Released To Return To Work 12-24-12 With No Restrictions\", \"diagnosis\": \"Rotator Cuff Tear/Sprain. Left Shoulder\", \"provider\": \"4043555555\", \"claimanttext\": \"Rise In Morning, Watch Local News, Exercise, Employment Search, Nap, Employment Search For Job That Physically And Mentally Needs Disabilities Daily Reading, Resting, Doing Housework And Yard work That I Can Do, But Not All That I Use To Do. Evenings I Spend Time W/Family, Early To Bed\", \"rtn2work\": \"Yes\"} "

IFS='|' read -ra ADDR <<< "$IN"
for i in "${ADDR[@]}"; do
FILE="/tmp/$RANDOM$RANDOM$RANDOM.json"

echo $i > $FILE

curl  -X POST -H "Content-Type: application/json"  --data @$FILE $appRoute/api/create
rm -f $FILE


done
echo .
echo .
echo "Done loading.  Let's test a query:"
curl  -X POST -H "Content-Type: application/json"  -d '{"type":"diagnosis", "value":"end stage osteoarthritis"}' $appRoute/api/query > /tmp/claims.json
echo .
minimumsize=10000
actualsize=$(wc -c <"/tmp/claims.json")
if [ $actualsize -ge $minimumsize ]; then
	echo .
    echo "Everything checks good!"
else
	echo .
    echo "Looks like we had a failure loading.  Check your work and try again."
fi

