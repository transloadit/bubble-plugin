function(properties, context) {
    //Load any data 

    Robodog.pick({
        target: 'body',
        restrictions: {
            maxNumberOfFiles: 1,
            maxFileSize: 5242880
        },
        params: {
            auth: { key: context.keys['AUTH KEY'] },
            template_id: context.keys['TEMPLATE ID']
        },
        waitForEncoding: true,
        providers: ['url', 'webcam', 'dropbox', 'google-drive', 'instagram']
    })
        .then((bundle) => {
            fetch(context.keys['NOTIFY URL'], {
                method: 'post',
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(bundle.transloadit)
            }).then(res => res.json())
                .then(res => console.log(res));

        })
}