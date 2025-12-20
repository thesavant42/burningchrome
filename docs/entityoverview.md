# OSINT Entity Relationship Diagram  

The models for the burning-chrome extension and the data types it will interact with.

## Layer 0 is loaded when the extension is launched via a cold open with no task associated.

[landing]
-  This is a layer "above" an active [project]; landing page,
- shows recently opened [projects],
- create new [projects], open recent [project],
- is only used for loading [projects];

-----

## Layer 1

[project] 

- [projets] may have many [domains], 
- many [subdomains], 
- many unique weyback streams, 
- **has no peers**;
- is top level for an open database.

---

## Layer 2

[domains]

- [Domains] may have many [subdomains], or none;
- May have [email], but may not
- A [domain] is a child of project and a parent to [subdomains], a peer to other [domains].
- may have an [app], many [apps], no [apps]


[PersonOfInterest] 
 - May have many [emails], 
 - may commit to many [repos] from many [emails] , 
 - May work for many [companies],
 - May have many [socialmediaaccounts],
 - May have many [phonenumbers].
 - Child of [Project], peer to [domains]. 
 - May be a member of an [org], or not, or many.
 - May be a [RepoCommitter], on none or many repos

[GitHubOrg]
 - Collection of related [Repositories] and their [commit] metadata,
 - may or may not have public [members].
 - Child of Project, sibling of domain
 - may be private

[GitHubRepo]
- may have many  [RepoCommitter],
- may have many branches,
- may have forks,
- may have an org or may not,
- must have at least one [committer].
- May be private
- Requires auth [credential] to write
- requires an email address 

---

## Layer 3

[subdomains]
- May have many or none sub-sub-domains, or sub sub sub sub domains, etc.
- Will always be a child of [domain] 
    - or [subdomain], *if* a [domain] is above it.
- currently enumerated via crt.sh alone;
  - need to add Virustotal API + Authentication via token
  - need a way to capture the user's api key and reuse it
    - github key too

[EmailAddress]
 - child of domain/or subdomain;
  - May be one owner or shared;
  - May be owned by a service
    - or a person
    - or a group of people.


[Service]
- the destination for a credential,
- not necessarily http,
- usually child of a domain;
  - may be more abstract a concept

[Credential]
- used to grant authentication and request authorizations,
- may be a service cred or an encryption key,
- or a generic secret.
- May have a username
- May have an access token.
  -  This is the most varied entity.

