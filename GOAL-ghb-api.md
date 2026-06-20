# grayhatwarfare rest api integration

## Goal: Integrate `https://buckets.grayhatwarfare.com/docs/api/v2` into the plugin

I have an API key for grayhatwarfare so let's use it. These are excerpts from the API documentation at https://buckets.grayhatwarfare.com/docs/api/v2


## Usage

Request urls, params and responses are described below.

For the API to function properly, all GET parameters of the request url should be url encoded. For example the space character " " should be replaced with "%20". You can use this tool to url encode your parameters.

Authentication
When making an API request you will need to provide your API access token. You can do so in either of the following ways:

As a header on the request:

```
Authorization: Bearer {apiKey}
```

As a query parameter on the request: `...&access_token={apiKey}...`

## Limits

### Premium users

 - For premium users there are no limits on the results someone can go through or the search filters/sorting they can use.
- There is however a limit on how many files you can get on each page. This limit is 1000. You can however read all the results page by page, by adjusting the start/limit params.
- Scrolling through an unlimited number of results on the result-set by specifying a scrolling mode other than offset is **restricted to enterprise users** and out of scope for this project.

### Registered users

For free registered users, the same limits on the results/filters/sorting as the search apply, explained here: Packages.
Search bucket files

The grayhat buckets API is free to use, and is extendible if you purchase an API key and send it as a Bearer token.

```javascript
const options = {
  method: 'GET',
  headers: {Authorization: 'Bearer c85305d58ad42caf50cf1842aac36dbe'}
};

fetch('https://buckets.grayhatwarfare.com/api/v2/files?keywords=2011%20-07&full-path=1&excluded-buckets=4%2C5&types=aws%2Cazure&limit=2', options)
  .then(response => response.json())
  .then(response => console.log(response))
  .catch(err => console.error(err));
```

Example Response:

```json
{
    "query": {
        "keywords": "2011 -07",
        "regexp": false,
        "noautocorrect": false,
        "buckets": [],
        "excludedBuckets": [
            "4",
            "5"
        ],
        "extensions": [],
        "stopExtensions": [],
        "fullPath": true,
        "lastModifiedFrom": null,
        "lastModifiedTo": null,
        "sizeFrom": null,
        "sizeTo": null,
        "order": "",
        "direction": "",
        "start": 0,
        "limit": 2
    },
    "meta": {
        "results": 905
    },
    "files": [
        {
            "id": "2101",
            "bucket": "G1gSjJJqWS.s3-eu-west-1.amazonaws.com",
            "bucketId": 6,
            "filename": "y5ENbP8QbN",
            "fullPath": "A1zq0vHLEN 2011 15/y5ENbP8QbN",
            "url": "http://G1gSjJJqWS.s3-eu-west-1.amazonaws.com/A1zq0vHLEN 2011 15/y5ENbP8QbN",
            "size": 2549108,
            "type": "aws",
            "lastModified": 1666666666
        },
        {
            "id": "2102",
            "bucket": "G1gSjJJqWS.s3-eu-west-1.amazonaws.com",
            "bucketId": 6,
            "filename": "uF7MqAOErU 2011 15",
            "fullPath": "uF7MqAOErU 2011 15",
            "url": "http://G1gSjJJqWS.s3-eu-west-1.amazonaws.com/uF7MqAOErU 2011 15",
            "size": 6156618,
            "type": "aws",
            "lastModified": 1666666666
        }
    ]
}
```

## Search bucket files

Example Request (with fake token):

```javascript
const options = {
  method: 'GET',
  headers: {Authorization: 'Bearer c85305d58ad42caf50cf1842aac36dbe'}
};

fetch('https://buckets.grayhatwarfare.com/api/v2/files?keywords=2011%20-07&full-path=1&excluded-buckets=4%2C5&types=aws%2Cazure&limit=2', options)
  .then(response => response.json())
  .then(response => console.log(response))
  .catch(err => console.error(err));
```

Example Response:

```json
{
    "query": {
        "keywords": "2011 -07",
        "regexp": false,
        "noautocorrect": false,
        "buckets": [],
        "excludedBuckets": [
            "4",
            "5"
        ],
        "extensions": [],
        "stopExtensions": [],
        "fullPath": true,
        "lastModifiedFrom": null,
        "lastModifiedTo": null,
        "sizeFrom": null,
        "sizeTo": null,
        "order": "",
        "direction": "",
        "start": 0,
        "limit": 2
    },
    "meta": {
        "results": 905
    },
    "files": [
        {
            "id": "2101",
            "bucket": "G1gSjJJqWS.s3-eu-west-1.amazonaws.com",
            "bucketId": 6,
            "filename": "y5ENbP8QbN",
            "fullPath": "A1zq0vHLEN 2011 15/y5ENbP8QbN",
            "url": "http://G1gSjJJqWS.s3-eu-west-1.amazonaws.com/A1zq0vHLEN 2011 15/y5ENbP8QbN",
            "size": 2549108,
            "type": "aws",
            "lastModified": 1666666666
        },
        {
            "id": "2102",
            "bucket": "G1gSjJJqWS.s3-eu-west-1.amazonaws.com",
            "bucketId": 6,
            "filename": "uF7MqAOErU 2011 15",
            "fullPath": "uF7MqAOErU 2011 15",
            "url": "http://G1gSjJJqWS.s3-eu-west-1.amazonaws.com/uF7MqAOErU 2011 15",
            "size": 6156618,
            "type": "aws",
            "lastModified": 1666666666
        }
    ]
}
```