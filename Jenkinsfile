pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
    }

    tools {
        nodejs 'nodejs-24'
    }

    environment {
        FRONT_INTERNAL_URL = 'http://bank-front:8080'
        SONARQUBE_INSTALLATION = 'sonarqube'
        SONAR_SCANNER_TOOL = 'sonar-scanner'

        NEXUS_DOCKER_REGISTRY = 'localhost:8084'
        NEXUS_DOCKER_API_URL  = 'http://host.docker.internal:8084'
        IMAGE_REPOSITORY      = 'localhost:8084/bank-front'
    }

    stages {
       stage('Checkout') {
            steps {
                script {
                    def scmVariables = checkout scm

                    env.GIT_COMMIT_SHA =
                        scmVariables['GIT_COMMIT'] ?: sh(
                            script: 'git rev-parse HEAD',
                            returnStdout: true
                        ).trim()

                    echo "Commit récupéré : ${env.GIT_COMMIT_SHA}"
                }
            }
        }

        stage('Preflight') {
            steps {
                sh '''
                    set -eu

                    echo "=== Node.js ==="
                    node --version

                    echo
                    echo "=== npm ==="
                    npm --version

                    echo
                    echo "=== Version Node attendue ==="
                    cat .nvmrc

                    ACTIVE_NODE="$(node --version | sed 's/^v//')"
                    EXPECTED_NODE="$(cat .nvmrc)"

                    if [ "$ACTIVE_NODE" != "$EXPECTED_NODE" ]; then
                        echo "Version Node incorrecte."
                        echo "Attendue : $EXPECTED_NODE"
                        echo "Active   : $ACTIVE_NODE"
                        exit 1
                    fi

                    echo
                    echo "=== Docker ==="
                    docker version \
                      --format 'Docker Server: {{.Server.Version}}'

                    echo
                    echo "=== Docker Compose ==="
                    docker compose version

                    echo
                    echo "=== curl ==="
                    command -v curl

                    echo
                    echo "=== Réseau Docker ==="
                    docker network inspect bank-net >/dev/null
                    echo "bank-net disponible"

                    echo
                    echo "=== Configuration Compose ==="
                    docker compose config >/dev/null
                    echo "compose.yaml valide"

                    echo
                    echo "=== Backend depuis Jenkins ==="
                    curl -fsS \
                      http://bank-api:8080/api/health
                '''
            }
        }

        stage('Version metadata') {
            steps {
                script {
                    env.APP_VERSION = sh(
                        script: '''
                            node -p "require('./package.json').version"
                        ''',
                        returnStdout: true
                    ).trim()

                    def lockVersion = sh(
                        script: '''
                            node -p "require('./package-lock.json').version"
                        ''',
                        returnStdout: true
                    ).trim()

                    def lockRootVersion = sh(
                        script: '''
                            node -p "
                                const lock = require('./package-lock.json');
                                lock.packages?.['']?.version ?? lock.version
                            "
                        ''',
                        returnStdout: true
                    ).trim()

                    def semverPattern =
                        '^(0|[1-9][0-9]*)\\.' +
                        '(0|[1-9][0-9]*)\\.' +
                        '(0|[1-9][0-9]*)' +
                        '(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$'

                    if (!(env.APP_VERSION ==~ semverPattern)) {
                        error(
                            "Version SemVer invalide : ${env.APP_VERSION}"
                        )
                    }

                    if (lockVersion != env.APP_VERSION) {
                        error(
                            "package-lock.json=${lockVersion}, " +
                            "package.json=${env.APP_VERSION}"
                        )
                    }

                    if (lockRootVersion != env.APP_VERSION) {
                        error(
                            "package-lock root=${lockRootVersion}, " +
                            "package.json=${env.APP_VERSION}"
                        )
                    }

                    echo "Version validée : ${env.APP_VERSION}"

                    env.GIT_SHORT_SHA = sh(
                        script: 'git rev-parse --short=12 HEAD',
                        returnStdout: true
                    ).trim()

                    env.BUILD_DATE = sh(
                        script: "date -u +'%Y-%m-%dT%H:%M:%SZ'",
                        returnStdout: true
                    ).trim()

                    env.IMAGE_TAG =
                        "${env.APP_VERSION}" +
                        "-b${env.BUILD_NUMBER}" +
                        "-${env.GIT_SHORT_SHA}"

                    env.IMAGE_REF =
                        "${env.IMAGE_REPOSITORY}:${env.IMAGE_TAG}"

                    env.RELEASE_GIT_TAG = sh(
                        script: """
                            git tag \
                            --points-at HEAD \
                            --list 'v${env.APP_VERSION}' |
                            head -n 1
                        """,
                        returnStdout: true
                    ).trim()

                    env.RELEASE_IMAGE_REF =
                        env.RELEASE_GIT_TAG
                            ? "${env.IMAGE_REPOSITORY}:${env.APP_VERSION}"
                            : ''

                    currentBuild.displayName =
                        "#${env.BUILD_NUMBER} ${env.IMAGE_TAG}"

                    writeFile(
                        file: 'build-metadata.properties',
                        text: """application=bank-front
                    version=${env.APP_VERSION}
                    gitCommit=${env.GIT_COMMIT_SHA}
                    gitShortSha=${env.GIT_SHORT_SHA}
                    gitTag=${env.RELEASE_GIT_TAG}
                    buildNumber=${env.BUILD_NUMBER}
                    buildDate=${env.BUILD_DATE}
                    image=${env.IMAGE_REF}
                    releaseImage=${env.RELEASE_IMAGE_REF}
                    """
                    )
                }

                sh '''
                    set -eu

                    test -s build-metadata.properties

                    echo "=== Métadonnées du build ==="
                    cat build-metadata.properties
                '''
            }
        }

        stage('Install dependencies') {
            steps {
                sh '''
                    set -eu

                    npm ci
                '''
            }
        }

        stage('Lint') {
            steps {
                timeout(
                    time: 5,
                    unit: 'MINUTES'
                ) {
                    sh '''
                        set -eu

                        echo "=== Nettoyage des artefacts précédents ==="

                        rm -rf \
                        coverage \
                        coverage-publish \
                        dist \
                        .angular/cache

                        echo

                        echo "=== Analyse ESLint ==="

                        npm run lint:ci

                        echo
                        echo "ESLint validé"
                    '''
                }
            }
        }

       stage('Unit tests and coverage') {
            steps {
                timeout(
                    time: 5,
                    unit: 'MINUTES'
                ) {
                    sh '''
                        set -eu

                        echo "=== Tests unitaires et couverture ==="

                        rm -rf \
                        coverage \
                        coverage-publish

                        npm run test:coverage

                        echo
                        echo "=== Fichiers de couverture générés ==="

                        find coverage \
                        -maxdepth 4 \
                        -type f \
                        | sort

                        echo
                        echo "=== Recherche des rapports ==="

                        HTML_INDEX="$(
                            find coverage \
                            -maxdepth 2 \
                            -type f \
                            -name index.html \
                            -print \
                            -quit
                        )"

                        LCOV_FILE="$(
                            find coverage \
                            -maxdepth 3 \
                            -type f \
                            -name lcov.info \
                            -print \
                            -quit
                        )"

                        JSON_SUMMARY="$(
                            find coverage \
                            -maxdepth 3 \
                            -type f \
                            -name coverage-summary.json \
                            -print \
                            -quit
                        )"

                        COBERTURA_FILE="$(
                            find coverage \
                            -maxdepth 3 \
                            -type f \
                            -name '*cobertura*.xml' \
                            -print \
                            -quit
                        )"

                        if [ -z "$HTML_INDEX" ]; then
                            echo "Rapport HTML de couverture introuvable."
                            exit 1
                        fi

                        if [ -z "$LCOV_FILE" ]; then
                            echo "Rapport LCOV introuvable."
                            exit 1
                        fi

                        if [ -z "$JSON_SUMMARY" ]; then
                            echo "Résumé JSON de couverture introuvable."
                            exit 1
                        fi

                        echo "HTML      : $HTML_INDEX"
                        echo "LCOV      : $LCOV_FILE"
                        echo "JSON      : $JSON_SUMMARY"
                        echo "Cobertura : ${COBERTURA_FILE:-non généré}"

                        echo
                        echo "=== Normalisation pour Jenkins ==="

                        REPORT_DIRECTORY="$(dirname "$HTML_INDEX")"

                        mkdir -p coverage-publish

                        cp -R \
                        "$REPORT_DIRECTORY/." \
                        coverage-publish/

                        cp \
                        "$LCOV_FILE" \
                        coverage-publish/lcov.info

                        cp \
                        "$JSON_SUMMARY" \
                        coverage-publish/coverage-summary.json

                        if [ -n "$COBERTURA_FILE" ]; then
                            cp \
                            "$COBERTURA_FILE" \
                            coverage-publish/cobertura-coverage.xml
                        fi

                        test -f coverage-publish/index.html
                        test -f coverage-publish/lcov.info
                        test -f coverage-publish/coverage-summary.json

                        echo
                        echo "Rapports de couverture validés"
                    '''
                }
            }

            post {
                always {
                    archiveArtifacts(
                        artifacts: '''
                            coverage/**/*,
                            coverage-publish/**/*
                        ''',
                        allowEmptyArchive: true,
                        fingerprint: false
                    )

                    publishHTML(
                        target: [
                            reportDir: 'coverage-publish',
                            reportFiles: 'index.html',
                            reportName: 'Couverture Angular',
                            reportTitles: 'Rapport de couverture',
                            keepAll: true,
                            alwaysLinkToLastBuild: true,
                            allowMissing: true
                        ]
                    )
                }
            }
        }

        stage('SonarQube analysis') {
            steps {
                timeout(
                    time: 10,
                    unit: 'MINUTES'
                ) {
                    script {
                        def scannerHome = tool env.SONAR_SCANNER_TOOL

                        withEnv([
                            "SONAR_SCANNER_HOME=${scannerHome}"
                        ]) {
                            withSonarQubeEnv(
                                installationName: env.SONARQUBE_INSTALLATION,
                                credentialsId: 'sonarqube-bank-front-token'
                            ) {
                                sh '''
                                    set -eu

                                    echo "=== Préparation SonarQube ==="

                                    rm -rf .scannerwork

                                    test -f sonar-project.properties
                                    test -f coverage/bank-front/lcov.info

                                    echo
                                    echo "Serveur SonarQube : $SONAR_HOST_URL"

                                    curl \
                                    -fsS \
                                    --connect-timeout 5 \
                                    --max-time 15 \
                                    "$SONAR_HOST_URL/api/system/status"

                                    echo
                                    echo
                                    echo "=== Version SonarScanner ==="

                                    "$SONAR_SCANNER_HOME/bin/sonar-scanner" \
                                    --version

                                    echo
                                    echo "=== Analyse SonarQube ==="

                                    "$SONAR_SCANNER_HOME/bin/sonar-scanner"

                                    test \
                                    -f .scannerwork/report-task.txt

                                    echo
                                    echo "Analyse SonarQube envoyée"
                                '''
                            }
                        }
                    }
                }
            }
        }

        stage('Quality Gate') {
            steps {
                timeout(
                    time: 10,
                    unit: 'MINUTES'
                ) {
                    script {
                        def qualityGate = waitForQualityGate(
                            abortPipeline: false,
                            webhookSecretId: 'sonarqube-webhook-secret'
                        )

                        echo "Quality Gate SonarQube : ${qualityGate.status}"

                        if (qualityGate.status != 'OK') {
                            error(
                                "Quality Gate SonarQube non validé : " +
                                qualityGate.status
                            )
                        }
                    }
                }
            }
        }

        stage('Build Angular') {
            steps {
                sh '''
                    set -eu

                    npm run build:prod

                    test \
                    -f dist/bank-front/browser/index.html

                    echo "Build Angular validé"
                '''

                script {
                    def gitTagJson = env.RELEASE_GIT_TAG
                        ? "\"${env.RELEASE_GIT_TAG}\""
                        : 'null'

                    writeFile(
                        file: 'dist/bank-front/browser/version.json',
                        text: """{
        "application": "bank-front",
        "version": "${env.APP_VERSION}",
        "image": "${env.IMAGE_REF}",
        "gitCommit": "${env.GIT_COMMIT_SHA}",
        "gitShortSha": "${env.GIT_SHORT_SHA}",
        "gitTag": ${gitTagJson},
        "buildNumber": ${env.BUILD_NUMBER},
        "buildDate": "${env.BUILD_DATE}"
        }
        """
                    )
                }

                sh '''
                    set -eu

                    test \
                    -f dist/bank-front/browser/version.json

                    node -e '
                        const fs = require("node:fs");

                        JSON.parse(
                            fs.readFileSync(
                                "dist/bank-front/browser/version.json",
                                "utf8"
                            )
                        );

                        console.log("version.json valide");
                    '

                    echo
                    echo "=== version.json ==="

                    cat \
                    dist/bank-front/browser/version.json

                    echo
                    echo "Build Angular versionné et validé"
                '''
            }
        }

        stage('Build image') {
            steps {
                sh '''
                    set -eu

                    echo "=== Image attendue ==="
                    echo "$IMAGE_REF"

                    echo
                    echo "=== Configuration Compose résolue ==="

                    docker compose config >/dev/null

                    RESOLVED_IMAGE="$(
                        docker compose config --images |
                        head -n 1
                    )"

                    echo "Image Compose : $RESOLVED_IMAGE"

                    if [ "$RESOLVED_IMAGE" != "$IMAGE_REF" ]; then
                        echo "Image Compose incorrecte."
                        echo "Attendue : $IMAGE_REF"
                        echo "Résolue  : $RESOLVED_IMAGE"
                        exit 1
                    fi

                    echo
                    echo "=== Construction de l’image ==="

                    docker compose build \
                    bank-front

                    docker image inspect \
                    "$IMAGE_REF" \
                    >/dev/null

                    echo
                    echo "=== Vérification des labels OCI ==="

                    IMAGE_VERSION="$(
                        docker image inspect \
                        --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' \
                        "$IMAGE_REF"
                    )"

                    IMAGE_REVISION="$(
                        docker image inspect \
                        --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
                        "$IMAGE_REF"
                    )"

                    IMAGE_CREATED="$(
                        docker image inspect \
                        --format '{{ index .Config.Labels "org.opencontainers.image.created" }}' \
                        "$IMAGE_REF"
                    )"

                    echo "Version  : $IMAGE_VERSION"
                    echo "Revision : $IMAGE_REVISION"
                    echo "Création : $IMAGE_CREATED"

                    test "$IMAGE_VERSION" = "$APP_VERSION"
                    test "$IMAGE_REVISION" = "$GIT_COMMIT_SHA"
                    test "$IMAGE_CREATED" = "$BUILD_DATE"

                    echo
                    echo "Image construite : $IMAGE_REF"
                '''
            }
        }

        stage('Publish image') {
            steps {
                timeout(
                    time: 10,
                    unit: 'MINUTES'
                ) {
                    withCredentials([
                        usernamePassword(
                            credentialsId: 'nexus-publisher',
                            usernameVariable: 'NEXUS_DOCKER_USERNAME',
                            passwordVariable: 'NEXUS_DOCKER_PASSWORD'
                        )
                    ]) {
                        sh '''
                            set -eu

                            export DOCKER_CONFIG="$WORKSPACE/.docker-nexus"

                            rm -rf \
                            "$DOCKER_CONFIG" \
                            published-manifest.json \
                            published-manifest.headers \
                            release-manifest.json \
                            release-manifest.headers \
                            existing-release-manifest.json \
                            existing-release-manifest.headers \
                            published-image.properties

                            mkdir -p "$DOCKER_CONFIG"

                            cleanup() {
                                rm -rf "$DOCKER_CONFIG"
                            }

                            trap cleanup EXIT HUP INT TERM

                            echo "=== Connexion au registry Nexus ==="
                            echo "Registry Docker : $NEXUS_DOCKER_REGISTRY"
                            echo "API Nexus       : $NEXUS_DOCKER_API_URL"

                            set +x

                            if ! printf '%s' "$NEXUS_DOCKER_PASSWORD" |
                                docker login \
                                "$NEXUS_DOCKER_REGISTRY" \
                                --username "$NEXUS_DOCKER_USERNAME" \
                                --password-stdin \
                                >/dev/null
                            then
                                set -x
                                echo "Échec de la connexion au registry Nexus."
                                exit 1
                            fi

                            set -x

                            echo "Connexion Nexus validée"

                            fetch_manifest_digest() {
                                IMAGE_REFERENCE="$1"
                                MANIFEST_FILE="$2"
                                HEADERS_FILE="$3"

                                case "$IMAGE_REFERENCE" in
                                    "$NEXUS_DOCKER_REGISTRY"/*)
                                        # Supprime uniquement le premier segment host:port/
                                        # Exemple :
                                        # localhost:8084/bank-front:0.1.0
                                        # devient :
                                        # bank-front:0.1.0
                                        IMAGE_WITH_TAG="${IMAGE_REFERENCE#*/}"
                                        ;;

                                    *)
                                        echo "Référence registry inattendue : $IMAGE_REFERENCE" >&2
                                        echo "Registry attendu : $NEXUS_DOCKER_REGISTRY" >&2
                                        return 1
                                        ;;
                                esac

                                REPOSITORY_NAME="${IMAGE_WITH_TAG%:*}"
                                TAG_VALUE="${IMAGE_WITH_TAG##*:}"

                                if [ -z "$REPOSITORY_NAME" ] ||
                                [ -z "$TAG_VALUE" ] ||
                                [ "$REPOSITORY_NAME" = "$IMAGE_WITH_TAG" ] ||
                                [ "$TAG_VALUE" = "$IMAGE_WITH_TAG" ]
                                then
                                    echo "Référence d’image invalide : $IMAGE_REFERENCE" >&2
                                    return 1
                                fi

                                MANIFEST_URL="${NEXUS_DOCKER_API_URL}/v2/${REPOSITORY_NAME}/manifests/${TAG_VALUE}"

                                rm -f \
                                "$MANIFEST_FILE" \
                                "$HEADERS_FILE"

                                echo "Manifest API : $MANIFEST_URL" >&2

                                set +e
                                set +x

                                HTTP_CODE="$(
                                    curl \
                                    --silent \
                                    --show-error \
                                    --connect-timeout 5 \
                                    --max-time 30 \
                                    --retry 4 \
                                    --retry-delay 1 \
                                    --retry-connrefused \
                                    --user "$NEXUS_DOCKER_USERNAME:$NEXUS_DOCKER_PASSWORD" \
                                    --header 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json' \
                                    --dump-header "$HEADERS_FILE" \
                                    --output "$MANIFEST_FILE" \
                                    --write-out '%{http_code}' \
                                    "$MANIFEST_URL"
                                )"

                                CURL_STATUS="$?"

                                set -x
                                set -e

                                if [ "$CURL_STATUS" -ne 0 ]; then
                                    echo "Erreur réseau pendant la lecture du manifest." >&2
                                    return 1
                                fi

                                case "$HTTP_CODE" in
                                    200)
                                        ;;

                                    404)
                                        echo "Manifest absent : $IMAGE_REFERENCE" >&2
                                        return 44
                                        ;;

                                    *)
                                        echo "Réponse Nexus inattendue : HTTP $HTTP_CODE" >&2
                                        cat "$MANIFEST_FILE" >&2 || true
                                        return 1
                                        ;;
                                esac

                                DIGEST="$(
                                    node -e '
                                        const fs = require("node:fs");

                                        const lines = fs
                                            .readFileSync(process.argv[1], "utf8")
                                            .split(String.fromCharCode(10))
                                            .map((line) =>
                                                line.replaceAll(
                                                String.fromCharCode(13),
                                                ""
                                                )
                                            );

                                        const digestHeader = lines.find(
                                        (line) =>
                                            line
                                            .toLowerCase()
                                            .startsWith("docker-content-digest:")
                                        );

                                        if (!digestHeader) {
                                        console.error(
                                            "Header Docker-Content-Digest introuvable"
                                        );
                                        process.exit(2);
                                        }

                                        const digest = digestHeader
                                        .slice(digestHeader.indexOf(":") + 1)
                                        .trim();

                                        process.stdout.write(digest);
                                    ' "$HEADERS_FILE"
                                )"

                                if ! printf '%s' "$DIGEST" |
                                    grep -Eq '^sha256:[0-9a-f]{64}$'
                                then
                                    echo "Digest Nexus invalide : $DIGEST" >&2
                                    return 1
                                fi

                                printf '%s' "$DIGEST"
                            }

                            echo
                            echo "=== Publication du tag CI ==="
                            echo "$IMAGE_REF"

                            docker push "$IMAGE_REF"

                            echo
                            echo "=== Vérification du manifest distant ==="

                            REMOTE_DIGEST="$(
                                fetch_manifest_digest \
                                "$IMAGE_REF" \
                                published-manifest.json \
                                published-manifest.headers
                            )"

                            echo "Digest Nexus : $REMOTE_DIGEST"

                            RELEASE_DIGEST=""

                            if [ -n "${RELEASE_GIT_TAG:-}" ]; then
                                echo
                                echo "=== Publication de la release ==="
                                echo "Tag Git       : $RELEASE_GIT_TAG"
                                echo "Image release : $RELEASE_IMAGE_REF"

                                if EXISTING_RELEASE_DIGEST="$(
                                    fetch_manifest_digest \
                                    "$RELEASE_IMAGE_REF" \
                                    existing-release-manifest.json \
                                    existing-release-manifest.headers
                                )"
                                then
                                    if ["$EXISTING_RELEASE_DIGEST" !="$REMOTE_DIGEST"]; then
                                        echo "Conflit de release immuable."
                                        echo \
                                        "Tag          : $RELEASE_IMAGE_REF"
                                        echo \
                                        "Digest Nexus : $EXISTING_RELEASE_DIGEST"
                                        echo \
                                        "Digest build : $REMOTE_DIGEST"

                                        exit 1
                                    fi

                                    RELEASE_DIGEST="$EXISTING_RELEASE_DIGEST"

                                    echo \
                                    "La release existe déjà avec le bon digest."
                                else
                                    FETCH_STATUS="$?"

                                    if [ "$FETCH_STATUS" -ne 44 ]; then
                                        echo \
                                        "Impossible de vérifier la release existante."

                                        exit "$FETCH_STATUS"
                                    fi

                                    docker image tag \
                                    "$IMAGE_REF" \
                                    "$RELEASE_IMAGE_REF"

                                    docker push \
                                    "$RELEASE_IMAGE_REF"

                                    RELEASE_DIGEST="$(
                                        fetch_manifest_digest \
                                        "$RELEASE_IMAGE_REF" \
                                        release-manifest.json \
                                        release-manifest.headers
                                    )"

                                    if ["$RELEASE_DIGEST" !="$REMOTE_DIGEST"]; then
                                        echo "Digest de release incohérent."
                                        echo \
                                        "Tag CI  : $REMOTE_DIGEST"
                                        echo \
                                        "Release : $RELEASE_DIGEST"

                                        exit 1
                                    fi

                                    echo \
                                    "Release publiée : $RELEASE_IMAGE_REF"
                                fi
                            else
                                echo
                                echo "Aucun tag Git de release sur ce commit."
                            fi

                            printf \
                            'image=%s\\ndigest=%s\\nimmutableRef=%s@%s\\nreleaseImage=%s\\nreleaseDigest=%s\\n' \
                            "$IMAGE_REF" \
                            "$REMOTE_DIGEST" \
                            "$IMAGE_REPOSITORY" \
                            "$REMOTE_DIGEST" \
                            "${RELEASE_IMAGE_REF:-}" \
                            "$RELEASE_DIGEST" \
                            > published-image.properties

                            printf \
                            'digest=%s\\nimmutableRef=%s@%s\\n' \
                            "$REMOTE_DIGEST" \
                            "$IMAGE_REPOSITORY" \
                            "$REMOTE_DIGEST" \
                            >> build-metadata.properties

                            echo
                            echo "=== Image publiée ==="

                            cat published-image.properties
                        '''
                    }
                }
            }
        }

        stage('Deploy') {
            steps {
                sh '''
                    set -eu

                    echo "=== Image publiée à déployer ==="
                    echo "$IMAGE_REF"

                    test \
                    -f published-image.properties

                    docker image inspect \
                    "$IMAGE_REF" \
                    >/dev/null

                    echo
                    echo "=== Déploiement Compose ==="

                    docker compose up \
                    -d \
                    --no-build \
                    bank-front

                    docker compose ps \
                    bank-front

                    CONTAINER_ID="$(
                        docker compose ps \
                        -q \
                        bank-front
                    )"

                    test -n "$CONTAINER_ID"

                    RUNNING_IMAGE_ID="$(
                        docker inspect \
                        --format '{{.Image}}' \
                        "$CONTAINER_ID"
                    )"

                    EXPECTED_IMAGE_ID="$(
                        docker image inspect \
                        --format '{{.Id}}' \
                        "$IMAGE_REF"
                    )"

                    if [ "$RUNNING_IMAGE_ID" != "$EXPECTED_IMAGE_ID" ]; then
                        echo "Le conteneur n’utilise pas l’image attendue."
                        echo "Image active   : $RUNNING_IMAGE_ID"
                        echo "Image attendue : $EXPECTED_IMAGE_ID"
                        exit 1
                    fi

                    echo
                    echo "Image déployée : $IMAGE_REF"
                '''
            }
        }

        stage('Smoke tests') {
            steps {
                sh '''
                    set -eu

                    echo "Attente du démarrage de bank-front..."

                    attempt=1

                    while true
                    do
                        HTTP_CODE="$(
                            curl \
                            -sS \
                            --connect-timeout 3 \
                            --max-time 5 \
                            -o frontend-health.json \
                            -w '%{http_code}' \
                            "$FRONT_INTERNAL_URL/health" ||
                            true
                        )"

                        if [ "$HTTP_CODE" = "200" ]; then
                            break
                        fi

                        if [ "$attempt" -ge 12 ]; then
                            echo "bank-front ne répond pas après 60 secondes."
                            echo "Dernier code HTTP : $HTTP_CODE"

                            cat frontend-health.json 2>/dev/null || true
                            docker compose ps
                            docker compose logs --tail=100 bank-front

                            exit 1
                        fi

                        echo "Tentative $attempt/12 — HTTP $HTTP_CODE"

                        attempt=$((attempt + 1))
                        sleep 5
                    done

                    echo
                    echo "=== Health frontend ==="
                    cat frontend-health.json

                    grep -q '"status":"UP"' frontend-health.json
                    grep -q '"service":"bank-front"' frontend-health.json

                    echo
                    echo "=== Backend via Nginx ==="

                    BACKEND_HTTP_CODE="$(
                        curl \
                        -sS \
                        --connect-timeout 3 \
                        --max-time 10 \
                        -o backend-health.json \
                        -w '%{http_code}' \
                        "$FRONT_INTERNAL_URL/actuator/health" ||
                        true
                    )"

                    if [ "$BACKEND_HTTP_CODE" != "200" ]; then
                        echo "Healthcheck backend en échec."
                        echo "Code HTTP : $BACKEND_HTTP_CODE"

                        cat backend-health.json 2>/dev/null || true
                        exit 1
                    fi

                    cat backend-health.json

                    grep -q '"status":"UP"' backend-health.json

                    echo
                    echo "=== Page Angular ==="

                    curl \
                    -fsS \
                    --connect-timeout 3 \
                    --max-time 10 \
                    "$FRONT_INTERNAL_URL/" |
                    grep -q '<bank-root'

                    echo "Composant bank-root détecté"
                    echo
                    echo "Déploiement frontend validé"

                    set -eu

                    echo "=== Version déployée ==="

                    curl \
                    -fsS \
                    --connect-timeout 3 \
                    --max-time 10 \
                    "$FRONT_INTERNAL_URL/version.json" \
                    > deployed-version.json

                    cat deployed-version.json

                    node -e '
                        const fs = require("node:fs");

                        const deployed = JSON.parse(
                            fs.readFileSync(
                                "deployed-version.json",
                                "utf8"
                            )
                        );

                        const expected = {
                            application: "bank-front",
                            version: process.env.APP_VERSION,
                            image: process.env.IMAGE_REF,
                            gitCommit: process.env.GIT_COMMIT_SHA,
                            gitShortSha: process.env.GIT_SHORT_SHA,
                            buildNumber: Number(process.env.BUILD_NUMBER),
                            buildDate: process.env.BUILD_DATE
                        };

                        for (const [key, expectedValue] of Object.entries(expected)) {
                            const actualValue = deployed[key];

                            if (actualValue !== expectedValue) {
                                throw new Error(
                                    `${key}: attendu=${expectedValue}, obtenu=${actualValue}`
                                );
                            }
                        }

                        console.log(
                            `Version déployée validée : ${deployed.version}`
                        );

                        console.log(
                            `Image déployée validée : ${deployed.image}`
                        );
                    '
                '''
            }
        }
    }

    post {
        success {
            echo 'Pipeline frontend terminé avec succès.'
        }

        failure {
            echo 'Échec du pipeline frontend.'

            sh '''
                docker compose ps || true

                docker compose logs \
                --tail=150 \
                bank-front || true
            '''
        }

        always {
            archiveArtifacts(
                artifacts: '''
                    build-metadata.properties,
                    deployed-version.json,
                    published-image.properties,
                    published-manifest.json,
                    release-manifest.json
                ''',
                allowEmptyArchive: true,
                fingerprint: true
            )

            echo "Build Jenkins : ${env.BUILD_NUMBER}"
            echo "Version       : ${env.APP_VERSION ?: 'inconnue'}"
            echo "Image         : ${env.IMAGE_REF ?: 'inconnue'}"
            echo "Commit Git    : ${env.GIT_COMMIT_SHA ?: 'inconnu'}"
        }
    }
}
