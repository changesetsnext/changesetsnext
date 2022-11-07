set -e

git pull

yarn build

# bump: patch | minor | major
changeset create --filter @changesetsnext/cli --bump patch --summary "update: version"

changeset version

git add .

git commit -m "Release version"

git push origin "main"

changeset publish

git push --follow-tags
