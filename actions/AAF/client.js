function(properties, context) {
    //Load any data 

    window.Uppy.pick({
        target: 'body',
        maxNumberOfFiles: 1,
        params: {
            auth: { key: context.keys['AUTH KEY'] },
            template_id: context.keys['TEMPLATE ID']
        },
        waitForEncoding: true
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